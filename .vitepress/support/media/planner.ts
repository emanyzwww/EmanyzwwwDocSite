/**
 * 媒体管线的**纯函数层**：格式裁决、档位计算、命名规则。
 *
 * 这一层刻意不碰文件系统、不 import sharp，因此可以直接被 vitest 加载
 * （本仓库 `tests/` 只测纯函数的约定，见 DEVELOPING.md 第九节）。
 */

import type { MediaKind } from './types'

/* ------------------------------------------------------------------ *
 * 常量：改这里等于改整条链路的行为，所以集中在一处
 * ------------------------------------------------------------------ */

/**
 * 展示档位（px）。
 *
 * 依据：正文最大宽度 `--layout-measure: 42rem = 672px`；
 * 移动端容器两侧各 16px → 内容宽 `calc(100vw - 32px)`，两者交点
 * **704px**（不是 720，720 是页头/布局的切换断点）。
 *
 * - 336：360px 屏 @1x（需求 328）
 * - 672：桌面 @1x
 * - 1008：360px 屏 @3x（需求 984）
 *
 * 刻意**不做** 1344 / 2016 进 srcset：会多吃 60–70% 的字节，收益只在
 * 3× DPR 的桌面上可见。放大查看走原图，不需要"母版"这一档。
 */
export const DISPLAY_WIDTHS = [336, 672, 1008] as const

/**
 * 转码产物的宽度上限。
 *
 * 超过这个宽度的源图，展示档位最高只出到 2016；完整原图仍然原样进产物，
 * 供查看器放大使用。取 2016 = 672 × 3，是"3 倍像素密度下仍不糊"的上限。
 */
export const MASTER_CAP = 2016

/** 小于这个宽度的图不再切档（切了也没区别，只会多几个文件）。 */
export const MIN_DISPLAY_WIDTH = 336

/**
 * `sizes` 属性。
 *
 * 704px 的推导见 `DISPLAY_WIDTHS` 上方注释 —— 它是 `672 + 32`（两侧各 16px）。
 * 写成 `min-width` 而不是 `max-width`，与 `mobile.css` 的写法方向相反，
 * 是因为这里是"桌面宽屏优先"的兜底：不支持媒体查询的浏览器取第一个值。
 */
export const SIZES = '(min-width: 704px) 672px, calc(100vw - 32px)'

/** WebP 默认质量。82 是实测拐点：78→82 只多 23% 字节换 +0.74dB。 */
export const WEBP_QUALITY = 82

/** 编码努力度。4 是 sharp 的类型声明默认值，速度/体积平衡最好。 */
export const WEBP_EFFORT = 4

/** 原图单文件上限：超过就报错，避免 4K 手机照把产物和带宽撑爆。 */
export const MAX_ORIGIN_BYTES = 40 * 1024 * 1024

/** 原图分辨率上限（像素）。超过就报错而不是静默降采样——静默降采样会丢掉"原图"。 */
export const MAX_ORIGIN_PIXELS = 50_000_000

/** 产物目录（相对产物根）。 */
export const MEDIA_DIR = 'assets/media'

/** 原图目录（相对产物根）。与变体分开放，便于将来整体排除。 */
export const ORIGIN_DIR = `${MEDIA_DIR}/orig`

/* ------------------------------------------------------------------ *
 * 格式裁决
 * ------------------------------------------------------------------ */

/** 能被 sharp 读、且浏览器也能直接显示原图的位图格式。 */
const RASTER_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'avif'])

/** 需要转、但转完浏览器才显示得了的格式（原图也进产物，只是打不开）。 */
const CONVERT_ONLY_EXTS = new Set(['tiff', 'tif', 'heic', 'heif'])

/** 明确不支持的格式：报错文案要能直接告诉作者怎么做。 */
const REJECTED_EXTS: Record<string, string> = {
  bmp: 'BMP 没有可用的解码器（sharp 预编译未带 ImageMagick）。请另存为 PNG 再引用。',
  ico: 'ICO 是多尺寸图标格式，不适合正文配图。请改用 PNG。',
  psd: 'PSD 是分层工程文件，浏览器无法显示。请导出为 PNG 再引用。',
}

/** 裁决结果。 */
export interface KindDecision {
  kind: MediaKind
  /** 是否转码；false 表示直接引用原文件。 */
  transcode: boolean
  /** 需要提醒作者的问题（不阻断构建）。 */
  warning?: string
}

/**
 * 由扩展名决定处理方式。
 *
 * @throws 遇到明确不支持的格式时抛出**可直接给作者看**的错误。
 */
export function decideKind(ext: string): KindDecision {
  const normalized = ext.toLowerCase().replace(/^\./, '')

  const rejected = REJECTED_EXTS[normalized]
  if (rejected) throw new Error(rejected)

  if (normalized === 'svg') {
    // 矢量：不栅格化。放大到任意倍数都清晰，栅格化反而是降级。
    return { kind: 'vector', transcode: false }
  }

  if (normalized === 'gif') {
    // 动图：转成 animated webp，保留动效。
    // 静帧化会让读者以为「图坏了」——实测 6 帧 GIF 静帧化后只剩首帧。
    return { kind: 'animated', transcode: true }
  }

  if (RASTER_EXTS.has(normalized)) return { kind: 'raster', transcode: true }

  if (CONVERT_ONLY_EXTS.has(normalized)) {
    return {
      kind: 'raster',
      transcode: true,
      warning: `${normalized} 无法被浏览器直接显示，查看器里的「原图」会打不开。建议另存为 PNG 或 JPG。`,
    }
  }

  throw new Error(
    `不支持的图片格式：.${normalized}。支持 png / jpg / jpeg / webp / avif / gif / svg，` +
      `以及可转换的 tiff / heic。`,
  )
}

/* ------------------------------------------------------------------ *
 * 档位计算
 * ------------------------------------------------------------------ */

/**
 * 由源图固有宽度算出要产出的档位。
 *
 * 三条规则（都有实测依据）：
 * 1. **永不放大**：大于等于固有宽的档位丢弃；
 * 2. **必须补一档原宽**（超过 `MASTER_CAP` 则补 `MASTER_CAP`）：
 *    否则 1200 宽的源图在 2× DPR 下只能用 1008 档，画质白损失；
 * 3. 源图比 `MIN_DISPLAY_WIDTH` 还小时只出一档 = 原宽。
 *
 * @example
 * ladderWidths(1200) // [336, 672, 1008, 1200]
 * ladderWidths(3000) // [336, 672, 1008, 2016]
 * ladderWidths(300)  // [300]
 */
export function ladderWidths(intrinsicWidth: number): number[] {
  if (!Number.isFinite(intrinsicWidth) || intrinsicWidth < 1) return []

  const width = Math.floor(intrinsicWidth)
  // `DISPLAY_WIDTHS` 声明成 `as const` 是为了保住字面量类型去做测试断言，
  // 但这里需要的是 number[]，所以显式放宽
  const widths: number[] = DISPLAY_WIDTHS.filter((candidate) => candidate < width)
  widths.push(Math.min(width, MASTER_CAP))

  return [...new Set(widths)].toSorted((a, b) => a - b)
}

/**
 * `src` 该用哪一档。
 *
 * 取「最接近 672 且不小于它」的那档；都小于 672 时取最大档。
 * 这条规则让不支持 `srcset` 的浏览器与 RSS 阅读器都拿到合理尺寸。
 */
export function pickSrcWidth(widths: readonly number[]): number {
  if (widths.length === 0) return 0

  const preferred = widths.find((width) => width >= 672)
  return preferred ?? widths[widths.length - 1]
}

/**
 * 按媒体类型算出要产出哪些宽度。
 *
 * - **矢量**（svg）：不转码。矢量放大到任意倍数都清晰，栅格化是降级。
 * - **动图**（gif）：只出一档（= 原宽，超过 `MASTER_CAP` 则压到 `MASTER_CAP`），
 *   转成 animated webp 保留动效。动图切多档会把文件数乘上帧数，收益不抵成本。
 * - **位图**：走 `ladderWidths`。
 */
export function planWidths(kind: MediaKind, intrinsicWidth: number): number[] {
  if (kind === 'vector') return []
  if (kind === 'animated') return [Math.min(Math.floor(intrinsicWidth), MASTER_CAP)]
  return ladderWidths(intrinsicWidth)
}

/* ------------------------------------------------------------------ *
 * 命名
 * ------------------------------------------------------------------ */

/** 指纹在文件名里的长度。48 位，与 Rollup 默认的 8 位同量级但更保守。 */
export const KEY_LENGTH = 12

/** 完整 sha256 → 文件名里用的短指纹。 */
export function shortKey(key: string): string {
  return key.slice(0, KEY_LENGTH)
}

/** 变体文件名（相对产物根）。 */
export function variantFileName(key: string, width: number): string {
  return `${MEDIA_DIR}/${shortKey(key)}-${width}.webp`
}

/**
 * LQIP（模糊缩略图）的文件名（相对产物根）。
 *
 * 只在构建期转码后**立刻 base64 内联进 `<img data-lqip>`**，
 * 不需要作为独立 URL 被引用；单独成文件是为了让构建期与 dev 的
 * `entry.files` 走同一条「文件名 → 字节」通道（见 registry.encode）。
 */
export function lqipFileName(key: string): string {
  return `${MEDIA_DIR}/${shortKey(key)}-lqip.webp`
}

/** 原图文件名（相对产物根）。扩展名决定浏览器能否直接显示。 */
export function originFileName(key: string, ext: string): string {
  return `${ORIGIN_DIR}/${shortKey(key)}.${ext.toLowerCase()}`
}

/**
 * 要放进 `<img src>` 的那一档文件名。
 *
 * 与 `pickSrcWidth` 配套：先选宽度，再按宽度取文件名。
 */
export function srcVariantFileName(key: string, widths: readonly number[]): string {
  return variantFileName(key, pickSrcWidth(widths))
}

/** `srcset` 属性值。 */
export function buildSrcset(variants: readonly { width: number; fileName: string }[]): string {
  return variants.map((variant) => `${variant.fileName} ${variant.width}w`).join(', ')
}

/* ------------------------------------------------------------------ *
 * URL
 * ------------------------------------------------------------------ */

/**
 * 站内路径 → 带部署 base 的 URL。
 *
 * **为什么不能省**：`config.ts` 里关闭了 `vue.template.transformAssetUrls`
 * 对绝对路径的改写（理由见 `PROPOSAL-image-pipeline.md` §4.1），
 * 因此 Vite 不再替我们补 base，必须自己拼。
 */
export function withBase(path: string, base: string): string {
  const normalizedBase = base.endsWith('/') ? base : `${base}/`
  const normalizedPath = path.replace(/^\/+/, '')
  return `${normalizedBase}${normalizedPath}`
}
