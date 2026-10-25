/**
 * 媒体注册表：**源文件路径 → 产物清单**的唯一权威。
 *
 * 设计上分两段，因为 markdown-it 的渲染是**同步**的、而转码是异步的：
 *
 * ```text
 * ① resolve()  同步：读字节 → sha256 → 探尺寸 → 裁决格式 → 算好所有文件名
 * ② encode()   异步：真正压 webp（构建期批量；dev 下按需）
 * ```
 *
 * 渲染规则只调 ①，因此它永远能在同步上下文里拿到 `<img src>` / `srcset`
 * 需要的全部信息；② 的结果只是字节，晚一点没关系。
 *
 * **去重键 = 源文件字节的 sha256**：中英文两篇文章各放一份相同的图，
 * 只要字节一样就命中同一个 entry，产物里只出一份。
 *
 * **`public/` 下的图不参与发射**：它们本来就会被原样拷进产物，
 * 再生成一份变体只会制造两个地址。这类资源直接引用原路径。
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, resolve } from 'node:path'

import {
  buildSrcset,
  decideKind,
  lqipFileName,
  MAX_ORIGIN_BYTES,
  MAX_ORIGIN_PIXELS,
  MEDIA_DIR,
  originFileName,
  planWidths,
  shortKey,
  SIZES,
  variantFileName,
  withBase,
} from './planner'
import { readImageSize } from './probe'
import { getMediaRuntime } from './runtime'
import { encodeLqip, encodeVariant, hashSource } from './transcode'
import type { MediaEntry, MediaVariant } from './types'

/* ------------------------------------------------------------------ *
 * 内部状态
 * ------------------------------------------------------------------ */

/** 绝对源路径 → entry。 */
const entries = new Map<string, MediaEntry>()

/** sha256 → entry。去重的第二层索引（不同路径、相同字节）。 */
const byKey = new Map<string, MediaEntry>()

/** 源路径 → 上次 resolve 时的 `mtime:size`，用于 dev 下失效。 */
const stamps = new Map<string, string>()

/** 已被引用过的源路径（构建期预扫用）。 */
const referenced = new Set<string>()

/** 已报过的提醒，避免同一句话刷几十遍。 */
const warned = new Set<string>()

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

/** 只报一次的作者级提醒。 */
export function warnOnce(message: string): void {
  if (warned.has(message)) return
  warned.add(message)
  console.warn(`\x1b[33m[media] ${message}\x1b[0m`)
}

/** 清空（仅供测试）。 */
export function clearMediaRegistry(): void {
  entries.clear()
  byKey.clear()
  stamps.clear()
  referenced.clear()
  warned.clear()
}

/** 所有被引用过的源路径（构建期预扫后可见）。 */
export function referencedSources(): string[] {
  return [...referenced]
}

/** 所有 entry（构建期发射用）。 */
export function allEntries(): MediaEntry[] {
  return [...entries.values()]
}

/** 是否是外链 / data URI / 协议相对地址。 */
export function isExternal(url: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url)
}

/** 路径末段。 */
export function baseName(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index === -1 ? path : path.slice(index + 1)
}

/** 绝对路径是否落在 `public/` 下。 */
export function isInPublic(sourcePath: string): boolean {
  const { publicDir } = getMediaRuntime()
  return resolve(sourcePath).startsWith(resolve(publicDir))
}

/* ------------------------------------------------------------------ *
 * 路径解析
 * ------------------------------------------------------------------ */

/**
 * 把 markdown 里的 `src` 解析成**绝对源路径**。
 *
 * 两种写法（与 VitePress 的语义对齐）：
 * - `./x.png` / `x.png` → 相对当前 markdown 所在目录
 * - `/x.png` → 相对 `public/`（作者自己的固定资源）
 *
 * 返回 `null` 表示"不是需要处理的本地图"（外链、data URI、纯锚点）。
 */
export function resolveSource(mdPath: string, src: string): string | null {
  if (!src || !src.trim()) return null
  if (isExternal(src) || src.startsWith('#')) return null

  // VitePress 的 imagePlugin 会给缺省前缀的相对路径补 `./`，这里两种都认
  const clean = decodeURIComponent(src.split(/[?#]/)[0] ?? '')
  if (!clean) return null

  if (clean.startsWith('/')) {
    const { publicDir } = getMediaRuntime()
    return resolve(publicDir, clean.replace(/^\/+/, ''))
  }

  return resolve(mdPath, '..', clean)
}

/* ------------------------------------------------------------------ *
 * resolve：同步
 * ------------------------------------------------------------------ */

/**
 * 解析一张图，返回产物清单。**同步**，可安全用于 markdown 渲染。
 *
 * @param sourcePath 绝对源路径
 * @throws 文件不存在、格式不支持、超大时抛出可直接给作者看的错误
 */
export function resolveMedia(sourcePath: string): MediaEntry {
  referenced.add(sourcePath)

  const stat = statSync(sourcePath, { throwIfNoEntry: false })
  if (!stat || !stat.isFile()) {
    throw new Error(
      `找不到图片：${sourcePath}\n` +
        `  相对路径相对 markdown 所在目录解析；以 / 开头则相对 public/。`,
    )
  }

  const stamp = `${stat.mtimeMs}:${stat.size}`
  const cached = entries.get(sourcePath)
  if (cached && stamps.get(sourcePath) === stamp) return cached

  const bytes = readFileSync(sourcePath)
  const ext = extname(sourcePath).slice(1).toLowerCase()
  const decision = decideKind(ext)

  if (decision.warning) warnOnce(`${baseName(sourcePath)}：${decision.warning}`)

  if (bytes.length > MAX_ORIGIN_BYTES) {
    throw new Error(
      `${baseName(sourcePath)} 有 ${(bytes.length / 1024 / 1024).toFixed(1)} MB，` +
        `超过单文件上限 ${MAX_ORIGIN_BYTES / 1024 / 1024} MB。请先降采样或裁掉无关部分。`,
    )
  }

  const size = readImageSize(bytes)
  if (!size) {
    throw new Error(
      `读不出 ${baseName(sourcePath)} 的尺寸（格式可能不受支持）。` +
        `支持 png / jpg / jpeg / webp / avif / gif / svg。`,
    )
  }

  if (size.width * size.height > MAX_ORIGIN_PIXELS) {
    throw new Error(
      `${baseName(sourcePath)} 是 ${size.width}×${size.height}，` +
        `超过 ${MAX_ORIGIN_PIXELS / 1_000_000} MP 上限。请先降采样。`,
    )
  }

  const key = hashSource(bytes)

  /*
   * 去重：不同路径、相同字节 → 复用第一个 entry。
   * 仍把**当前路径**登记进 entries，避免同一条路径每次都重算哈希。
   */
  const existing = byKey.get(key)
  if (existing) {
    entries.set(sourcePath, existing)
    stamps.set(sourcePath, stamp)
    return existing
  }

  // public/ 下的资源不重命名、不转码：原样引用原路径
  const inPublic = isInPublic(sourcePath)

  const widths = decision.transcode && !inPublic ? planWidths(decision.kind, size.width) : []

  const variants: MediaVariant[] = widths.map((width) => ({
    width,
    fileName: variantFileName(key, width),
    bytes: 0,
  }))

  /*
   * LQIP 文件名在 resolve（同步）阶段就定下来：与变体同一条命名纪律
   * （sha256 → 名字），encode（异步）阶段只负责填字节。
   * public/ 资源不转码，因此也没有 LQIP。
   */
  const lqip = decision.transcode && !inPublic ? lqipFileName(key) : null

  const entry: MediaEntry = {
    key,
    sourcePath,
    ext,
    kind: decision.kind,
    intrinsicWidth: size.width,
    intrinsicHeight: size.height,
    originFileName: inPublic ? null : originFileName(key, ext),
    originBytes: bytes.length,
    lqipFileName: lqip,
    variants,
    files: new Map(),
  }

  entries.set(sourcePath, entry)
  byKey.set(key, entry)
  stamps.set(sourcePath, stamp)
  return entry
}

/* ------------------------------------------------------------------ *
 * 渲染属性
 * ------------------------------------------------------------------ */

/** 一张图渲染成 HTML 所需的全部属性。 */
export interface MediaMarkup {
  /** `<img src>`，已含 base。 */
  src: string
  /** `<img srcset>`，已含 base；没有多档时为空串。 */
  srcset: string
  /** `<img sizes>`；没有多档时为空串。 */
  sizes: string
  /** 固有宽度。作者用 attrs 显式指定时由调用方覆盖。 */
  width: number
  /** 固有高度。 */
  height: number
  /** 放大查看 / 下载用的原图 URL，已含 base。 */
  origin: string
  /** 原始文件名（下载默认文件名，比哈希名友好）。 */
  originName: string
  /** 内容指纹，供查看器做画廊去重。 */
  key: string
  /**
   * LQIP 占位图（`data:` URI，base64 webp）。
   *
   * 空串 = 没有 LQIP（矢量 / 窄图 / 转码失败），渲染侧跳过该属性。
   * 用 `data:` 而不是独立 URL：占位必须与 `<img>` 同请求到达，
   * 走网络就失去「先有颜色再等图」的意义。
   */
  lqip: string
}

/**
 * 生成渲染属性。
 *
 * 三种情况：
 * - 多档位图 → `src` 取最接近 672 的档 + `srcset`
 * - `public/` 资源 → `src` 直指原路径（不参与发射）
 * - 矢量 / 动图 → `src` 直指原图地址
 *
 * LQIP：字节已就绪时转成 `data:` URI（base64 webp）内联；
 * 字节未就绪（dev 按需转码还没跑到）或根本没有 LQIP 时为空串。
 */
export function markupOf(entry: MediaEntry): MediaMarkup {
  const { base } = getMediaRuntime()

  const origin = entry.originFileName
    ? withBase(entry.originFileName, base)
    : withBase(publicPathOf(entry.sourcePath), base)

  const common = {
    width: entry.intrinsicWidth,
    height: entry.intrinsicHeight,
    origin,
    originName: baseName(entry.sourcePath),
    key: shortKey(entry.key),
    lqip: lqipDataUriOf(entry),
  }

  if (entry.variants.length === 0) {
    return { ...common, src: origin, srcset: '', sizes: '' }
  }

  const preferred =
    entry.variants.find((variant) => variant.width >= 672) ??
    entry.variants[entry.variants.length - 1]

  return {
    ...common,
    src: withBase(preferred.fileName, base),
    srcset: buildSrcset(
      entry.variants.map((variant) => ({
        width: variant.width,
        fileName: withBase(variant.fileName, base),
      })),
    ),
    sizes: SIZES,
  }
}

/** LQIP 字节 → `data:` URI；没有就绪的字节时返回空串。 */
function lqipDataUriOf(entry: MediaEntry): string {
  if (!entry.lqipFileName) return ''
  const bytes = entry.files.get(fileNameOf(entry.lqipFileName))
  return bytes ? `data:image/webp;base64,${bytes.toString('base64')}` : ''
}

/** `public/` 下的绝对路径 → 站内路径。 */
function publicPathOf(sourcePath: string): string {
  const { publicDir } = getMediaRuntime()
  const relative = resolve(sourcePath).slice(resolve(publicDir).length)
  return relative.startsWith('/') || relative.startsWith('\\') ? relative : `/${relative}`
}

/* ------------------------------------------------------------------ *
 * encode：异步
 * ------------------------------------------------------------------ */

/** 从 `assets/media/xxx-672.webp` 取文件名（`entry.files` 的键）。 */
function fileNameOf(fileName: string): string {
  return fileName.slice(fileName.lastIndexOf('/') + 1)
}

/**
 * 把一个 entry 的所有变体压出来，结果放进 `entry.files`。
 * 幂等：已压过的变体不会重复压。
 *
 * 变体之间**串行**而不是 `Promise.all`：
 * 同一张源的各档共用一次解码最省 CPU（sharp 内部会复用输入缓冲），
 * 并行反而让 libvips 的线程池互相抢占 —— 实测 4 档 140ms 的活，
 * 并行后总时长反而更长。跨图的并行由 `encodeAll` 负责。
 */
export async function encode(entry: MediaEntry): Promise<void> {
  if (entry.variants.length === 0) return

  const pending = entry.variants.filter((variant) => !entry.files.has(fileNameOf(variant.fileName)))
  if (pending.length === 0) return

  const source = readFileSync(entry.sourcePath)
  const animated = entry.kind === 'animated'

  for (const variant of pending) {
    // oxlint-disable-next-line no-await-in-loop -- 同一源图的各档串行更省 CPU（见上）
    const bytes = await encodeVariant({
      source,
      width: variant.width,
      hash: entry.key,
      animated,
    })
    entry.files.set(fileNameOf(variant.fileName), bytes)
    variant.bytes = bytes.length
  }

  /*
   * LQIP：展示档压完后顺手压一张极小模糊图。
   * 幂等（files 里有了就跳过）；失败为 `null` 字节 = 无 LQIP，
   * 渲染侧按「没有这个属性」处理。
   */
  if (entry.lqipFileName && !entry.files.has(fileNameOf(entry.lqipFileName))) {
    const bytes = await encodeLqip({
      source,
      hash: entry.key,
      kind: entry.kind,
      intrinsicWidth: entry.intrinsicWidth,
    })
    if (bytes) entry.files.set(fileNameOf(entry.lqipFileName), bytes)
  }
}

/**
 * 构建期：把所有被引用过的图全部压好。
 *
 * 用「游标 + N 个 worker」而不是 `Promise.all(list.map(encode))`：
 * sharp 是 CPU 密集的，一次性把几十张图丢进去只会让 libvips 的线程池
 * 互相抢占、内存暴涨。固定并发等于给流水线装了个节流阀。
 *
 * @param concurrency 并发上限。
 */
export async function encodeAll(concurrency = 4): Promise<void> {
  const list = allEntries()
  if (list.length === 0) return

  let cursor = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= list.length) return
      // oxlint-disable-next-line no-await-in-loop -- 这里就是串行取任务的调度器
      await encode(list[index])
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker))
}

/* ------------------------------------------------------------------ *
 * dev：按需转码
 * ------------------------------------------------------------------ */

/**
 * dev 中间件用：按请求路径反查 entry 并按需转码。
 *
 * 三种形态：
 * - `assets/media/<sha12>-672.webp` → 该档 webp
 * - `assets/media/<sha12>-lqip.webp` → LQIP 模糊缩略图（encode 会一并产出）
 * - `assets/media/orig/<sha12>.<ext>` → 原图**原始字节**（不重新编码，保证"完整原图"）
 */
export async function ensureFileByRequest(relative: string): Promise<Buffer | null> {
  if (!relative.startsWith(`${MEDIA_DIR}/`)) return null

  const name = relative.slice(MEDIA_DIR.length + 1)
  const isOrigin = name.startsWith('orig/')
  const short = isOrigin
    ? name.slice(name.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '')
    : name.replace(/-\d+\.webp$/, '').replace(/-lqip\.webp$/, '')

  const entry = [...byKey.values()].find((candidate) => shortKey(candidate.key) === short)
  if (!entry) return null

  if (isOrigin) return readFileSync(entry.sourcePath)

  // LQIP 与展示档共用同一条 encode 通道（encode 会把两种字节都备齐）
  await encode(entry)
  return entry.files.get(name) ?? null
}

/* ------------------------------------------------------------------ *
 * 断言
 * ------------------------------------------------------------------ */

/**
 * 构建期：校验所有变体都已产出字节，且同一文件名只有一份内容。
 *
 * 第二条防的是 Rollup 的静默覆盖：重复 `fileName` **只 WARN 且首次胜出**，
 * 第二个版本会被无声丢弃。自己先断言，问题就会在构建期暴露。
 */
export function assertReady(): void {
  const seen = new Map<string, Buffer>()

  for (const entry of allEntries()) {
    for (const variant of entry.variants) {
      const name = fileNameOf(variant.fileName)
      const bytes = entry.files.get(name)
      if (!bytes) {
        throw new Error(
          `媒体产物缺失：${variant.fileName}（源 ${baseName(entry.sourcePath)}，宽 ${variant.width}）。` +
            `通常是 buildStart 预扫漏掉了这篇内容。`,
        )
      }

      const previous = seen.get(variant.fileName)
      if (previous && !previous.equals(bytes)) {
        throw new Error(`媒体产物文件名冲突且内容不同：${variant.fileName}。请检查命名规则。`)
      }
      seen.set(variant.fileName, bytes)
    }
  }
}

/** 目录不存在时给出更好懂的报错。 */
export function assertReadable(sourcePath: string): void {
  if (!existsSync(sourcePath)) throw new Error(`找不到图片：${sourcePath}`)
}
