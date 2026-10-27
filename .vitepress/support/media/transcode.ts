/**
 * 转码层：把源图字节变成各档 webp（以及原图字节）。
 *
 * **这是唯一 import `sharp` 的文件。** 其余模块只跟"字节 + 名字"打交道，
 * 因此单测不需要装原生模块也能跑（`tests/` 只测纯函数，见 DEVELOPING.md 第九节）。
 *
 * 三条硬约束，每条都是踩过的坑：
 *
 * 1. **必须 `.rotate()`**。sharp 默认剥掉 EXIF，方向信息一旦丢了就永久错，
 *    表现为「手机竖拍的图在网页上横躺」。
 * 2. **必须 `.toColourspace('srgb')`**。CMYK / Display-P3 的源图不转就会偏色。
 * 3. **参数必须写死并进缓存键**。同一份源图换个 quality 就是另一份产物，
 *    缓存键不含参数会让两套参数互相串味。
 */

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import sharp from 'sharp'

import { WEBP_EFFORT, WEBP_QUALITY } from './planner'
import type { MediaKind } from './types'

/**
 * 管线版本。
 *
 * 改了编码参数、档位算法、命名规则，都要 +1 —— 否则磁盘缓存会继续返回
 * 旧参数产出的字节，且**没有任何提示**。
 *
 * v2：新增 LQIP（模糊缩略图）产物。缓存键已包含本常量，旧缓存自然失效。
 */
export const PIPELINE_VERSION = 2

/** LQIP（模糊缩略图）的目标宽度（px）。
 *
 * 只当「图片加载前的色彩占位」用，最终会以 base64 内联进 `<img>` 的
 * `data-lqip` 属性。20px 宽的 webp（quality 30）实测 200–400 B，
 * base64 后约 300–550 B —— 内联进 HTML 的体积代价可以忽略。
 * **永不放大**：源图比它还窄时不出 LQIP（那种图本来就秒加载）。
 */
export const LQIP_WIDTH = 20

/** LQIP 的 webp 质量。模糊图不需要保真，低质量换体积。 */
export const LQIP_QUALITY = 30

/** LQIP 的缓存键（独立于展示档位：宽度与参数都不同）。 */
function lqipCacheKey(hash: string, kind: MediaKind): string {
  return createHash('sha256')
    .update(
      [
        hash,
        LQIP_WIDTH,
        kind,
        LQIP_QUALITY,
        'lqip',
        PIPELINE_VERSION,
        process.platform,
        sharp.versions.vips,
        sharp.versions.webp,
      ].join('|'),
    )
    .digest('hex')
}

/**
 * 生成一张图的 LQIP（极小模糊缩略图）字节。
 *
 * - **模糊在编码端完成**（先 resize 后 blur），不靠浏览器 CSS blur：
 *   20px 的图浏览器拉伸放大本身就是模糊的，再叠 blur 只是把色带抹平；
 * - 矢量（svg）不出 LQIP：矢量本身零延迟，占位反而多余；
 * - 失败返回 `null`（LQIP 是体验增强，绝不能让它弄挂构建）。
 */
export async function encodeLqip(input: {
  source: Buffer
  hash: string
  kind: MediaKind
  intrinsicWidth: number
}): Promise<Buffer | null> {
  // 矢量不出；源图比目标还窄也不出（永不放大原则）
  if (input.kind === 'vector') return null
  if (input.intrinsicWidth <= LQIP_WIDTH) return null

  const key = lqipCacheKey(input.hash, input.kind)
  const cached = readCache(key)
  if (cached) return cached

  try {
    const bytes = await sharp(input.source, { animated: false })
      .rotate()
      .resize({ width: LQIP_WIDTH, withoutEnlargement: true })
      .blur(2)
      .toColourspace('srgb')
      .webp({ quality: LQIP_QUALITY })
      .toBuffer()
    writeCache(key, bytes)
    return bytes
  } catch {
    // LQIP 是增强：任何失败都静默降级为「无 LQIP」，不阻断转码主管线
    return null
  }
}

/** 磁盘缓存的目录。放在 `.vitepress/cache/` 下，已被 `.gitignore` 与 `.oxfmtignore` 忽略。 */
let cacheDir: string | null = null

/** 注入缓存目录（由 `media/vite.ts` 在 `configResolved` 里调用）。 */
export function setMediaCacheDir(dir: string): void {
  cacheDir = dir
}

/**
 * 缓存键。
 *
 * **必须包含平台与 libvips 版本**：Windows 与 Linux 的 libvips 构建不同，
 * 同一份源图编出来的字节可能不一致。少了这两项，本地产物会被 CI 的缓存
 * 悄悄冒充，出现「本地对、线上不对」这种最难查的故障。
 */
function cacheKey(input: { hash: string; width: number; kind: MediaKind }): string {
  return createHash('sha256')
    .update(
      [
        input.hash,
        input.width,
        input.kind,
        WEBP_QUALITY,
        WEBP_EFFORT,
        PIPELINE_VERSION,
        process.platform,
        sharp.versions.vips,
        sharp.versions.webp,
      ].join('|'),
    )
    .digest('hex')
}

/** 读缓存；没有就返回 `null`。 */
function readCache(key: string): Buffer | null {
  if (!cacheDir) return null
  const file = resolve(cacheDir, `${key}.webp`)
  if (!existsSync(file)) return null
  try {
    return readFileSync(file)
  } catch {
    return null
  }
}

/** 写缓存；失败不影响构建（缓存只是加速手段）。 */
function writeCache(key: string, bytes: Buffer): void {
  if (!cacheDir) return
  try {
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(resolve(cacheDir, `${key}.webp`), bytes)
  } catch {
    // 缓存目录不可写时静默跳过：产物仍然正确，只是慢一点
  }
}

/**
 * 把源图压成指定宽度的 webp。
 *
 * @param source 源文件字节
 * @param width 目标宽度（px）。调用方保证 `width <= 固有宽度`
 * @param hash 源字节的 sha256，只用于缓存键
 * @param animated 是否保留动图帧（gif → animated webp）
 */
export async function encodeVariant(input: {
  source: Buffer
  width: number
  hash: string
  animated: boolean
}): Promise<Buffer> {
  const key = cacheKey({
    hash: input.hash,
    width: input.width,
    kind: input.animated ? 'animated' : 'raster',
  })
  const cached = readCache(key)
  if (cached) return cached

  const pipeline = sharp(input.source, { animated: input.animated })
    // 方向必须在剥 EXIF 之前烘焙进像素
    .rotate()
    .resize({ width: input.width, withoutEnlargement: true })
    .toColourspace('srgb')

  const bytes = await pipeline
    .webp({
      quality: WEBP_QUALITY,
      // 100 是刻意的：实测几乎不影响体积（平坦 alpha 下 q100 与 q60 完全相同），
      // 但为了省几百字节牺牲边缘质量不划算
      alphaQuality: 100,
      effort: WEBP_EFFORT,
    })
    .toBuffer()

  writeCache(key, bytes)
  return bytes
}

/** 源图字节的 sha256。去重、命名、缓存全都以它为键。 */
export function hashSource(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** 确保目录存在（dev 下按需写缓存用）。 */
export function ensureDir(file: string): void {
  mkdirSync(dirname(file), { recursive: true })
}
