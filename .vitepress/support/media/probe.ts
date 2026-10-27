/**
 * 图片头部探测：**同步**读出固有宽高，零依赖。
 *
 * 为什么必须同步：markdown-it 的渲染规则是同步的，而我们要在渲染那一刻
 * 就写出 `width` / `height` 属性（否则首屏会跳版，CLS 直接变差）。
 * sharp 的 `metadata()` 是异步的，用不上。
 *
 * 为什么自己写而不装 `image-size`：需要的格式只有下面这几个，每个 10–30 行；
 * 装一个包反而要跟着它的 ESM/CJS 双轨声明走一遍（本仓库已经在
 * `support/markdown-plugins.ts` 顶部记录过同类踩坑）。
 *
 * 只覆盖**会在本站在文章里出现**的格式。tiff / heic / bmp 故意不支持：
 * 浏览器本身也显示不了原图，与其静默降级，不如在构建期报错让作者换格式
 * （见 `planner.ts` 的 `decideKind`）。
 */

/** 固有尺寸。 */
export interface ImageSize {
  width: number
  height: number
}

function be16(bytes: Uint8Array, i: number): number {
  return (bytes[i] << 8) | bytes[i + 1]
}

function be32(bytes: Uint8Array, i: number): number {
  return ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0
}

function le16(bytes: Uint8Array, i: number): number {
  return bytes[i] | (bytes[i + 1] << 8)
}

function le32(bytes: Uint8Array, i: number): number {
  return (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)) >>> 0
}

/** PNG：IHDR 的宽高在固定偏移 16 / 20（大端）。 */
function pngSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 24) return null
  return { width: be32(bytes, 16), height: be32(bytes, 20) }
}

/**
 * JPEG：逐段扫描到 SOFn（帧头）才有尺寸。
 *
 * 不能只读固定偏移——EXIF / ICC / 缩略图都会改变实际位置。
 * `0xC4`（DHT）、`0xC8`（JPG）、`0xCC`（DAC）虽然在 0xC0–0xCF 区间里，
 * 但**不是** SOF，必须排除，否则会读到随机字节当宽高。
 */
function jpegSize(bytes: Uint8Array): ImageSize | null {
  let i = 2
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1
      continue
    }
    const marker = bytes[i + 1]
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2
      continue
    }
    const length = be16(bytes, i + 2)
    if (length < 2) return null
    const isFrameHeader =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isFrameHeader) return { width: be16(bytes, i + 7), height: be16(bytes, i + 5) }
    i += 2 + length
  }
  return null
}

/**
 * WebP：三种子格式的宽高位置各不相同。
 *
 * - `VP8 `（有损）：数据区固定起始码 `9d 01 2a`，之后各 14 位宽高
 * - `VP8L`（无损）：签名 `0x2f`，之后两段 14 位存的是 **宽高 − 1**
 * - `VP8X`（扩展，动图/透明）：24 位画布宽高，同样存 − 1
 */
function webpSize(bytes: Uint8Array): ImageSize | null {
  const fourcc = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15])

  if (fourcc === 'VP8 ') {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null
    return {
      width: le16(bytes, 26) & 0x3fff,
      height: le16(bytes, 28) & 0x3fff,
    }
  }

  if (fourcc === 'VP8L') {
    if (bytes[20] !== 0x2f) return null
    const bits = le32(bytes, 21)
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
    }
  }

  if (fourcc === 'VP8X') {
    const width = bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)
    const height = bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)
    return { width: width + 1, height: height + 1 }
  }

  return null
}

/** GIF：逻辑屏幕描述符里的小端 16 位宽高。 */
function gifSize(bytes: Uint8Array): ImageSize | null {
  return { width: le16(bytes, 6), height: le16(bytes, 8) }
}

/** SVG：优先 width/height 属性，缺一个就退回 viewBox。 */
function svgSize(bytes: Uint8Array): ImageSize | null {
  const head = new TextDecoder('utf-8', { fatal: false }).decode(
    bytes.subarray(0, Math.min(bytes.length, 4096)),
  )
  const tag = /<svg\b[^>]*>/i.exec(head)?.[0]
  if (!tag) return null

  /*
   * 前面必须有一个空白或行首，不能用 `\b`：
   * `stroke-width` 里 `-w` 之间也是词边界，`\bwidth` 会误命中描边宽度。
   */
  const attr = (name: string): number | null => {
    const match = new RegExp(
      `(?:^|\\s)${name}\\s*=\\s*["']\\s*([\\d.]+)\\s*(?:px)?\\s*["']`,
      'i',
    ).exec(tag)
    return match ? Number(match[1]) : null
  }

  const width = attr('width')
  const height = attr('height')
  if (width && height) return { width: Math.round(width), height: Math.round(height) }

  const viewBox =
    /(?:^|\s)viewBox\s*=\s*["']\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i.exec(
      tag,
    )
  if (viewBox)
    return { width: Math.round(Number(viewBox[3])), height: Math.round(Number(viewBox[4])) }

  return null
}

/** ISO BMFF 的一个 box。 */
interface Box {
  /** 负载起点（已跳过 box header）。 */
  dataStart: number
  /** box 结束位置（不含）。 */
  end: number
}

function readBox(
  bytes: Uint8Array,
  at: number,
  limit: number,
): (Box & { size: number; type: string }) | null {
  if (at + 8 > limit) return null
  let size = be32(bytes, at)
  const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7])
  let header = 8
  if (size === 1) {
    // 64 位长度：前 4 字节通常为 0，拼成 Number 足够表示图片文件
    if (at + 16 > limit) return null
    size = be32(bytes, at + 8) * 4294967296 + be32(bytes, at + 12)
    header = 16
  } else if (size === 0) {
    size = limit - at
  }
  if (size < header || at + size > limit) return null
  return { size, type, dataStart: at + header, end: at + size }
}

/** 在 `[start, end)` 里找第一个指定类型的 box。 */
function findBox(bytes: Uint8Array, start: number, end: number, type: string): Box | null {
  let i = start
  while (i < end) {
    const box = readBox(bytes, i, end)
    if (!box) return null
    if (box.type === type) return { dataStart: box.dataStart, end: box.end }
    i += box.size
  }
  return null
}

/**
 * AVIF：`ftyp` → `meta`（FullBox） → `iprp` → `ipco` → `ispe`（FullBox）。
 *
 * 路径看着长，但每一步都是「在给定范围内顺序找 box」，比按固定偏移猜要稳。
 */
function avifSize(bytes: Uint8Array): ImageSize | null {
  const ftyp = readBox(bytes, 0, bytes.length)
  if (!ftyp || ftyp.type !== 'ftyp') return null

  const meta = findBox(bytes, 0, bytes.length, 'meta')
  // `meta` 是 FullBox：负载前 4 字节是 version + flags
  if (!meta) return null
  const iprp = findBox(bytes, meta.dataStart + 4, meta.end, 'iprp')
  if (!iprp) return null
  const ipco = findBox(bytes, iprp.dataStart, iprp.end, 'ipco')
  if (!ipco) return null

  let i = ipco.dataStart
  while (i < ipco.end) {
    const box = readBox(bytes, i, ipco.end)
    if (!box) return null
    if (box.type === 'ispe') {
      // FullBox 之后依次是 32 位宽、32 位高
      const width = be32(bytes, box.dataStart + 4)
      const height = be32(bytes, box.dataStart + 8)
      if (width > 0 && height > 0) return { width, height }
      return null
    }
    i += box.size
  }
  return null
}

/** 按魔数分派；不认识的格式返回 `null`。 */
export function readImageSize(bytes: Uint8Array): ImageSize | null {
  /*
   * 最短的判定门槛取 12：GIF 的逻辑屏幕描述符只需 13 字节，
   * 而 PNG / JPEG / WebP 各自在下面的解析里还有更严格的长度检查。
   * 写成 16 会把「只有头的 GIF」直接判死（单测里就是这个场景）。
   */
  if (bytes.length < 12) return null

  // PNG
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return pngSize(bytes)
  }

  // JPEG
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegSize(bytes)

  // WebP：RIFF....WEBP
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return webpSize(bytes)
  }

  // GIF
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return gifSize(bytes)

  // SVG：靠文本前缀判断，允许 XML 声明与注释在前面
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 1024))
  if (head.includes('<svg')) return svgSize(bytes)

  // AVIF（ISO BMFF）
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    return avifSize(bytes)
  }

  return null
}
