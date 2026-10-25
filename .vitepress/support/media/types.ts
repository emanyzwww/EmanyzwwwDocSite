/**
 * 媒体资源的公共类型。
 *
 * 这个模块是「一张图从源文件到产物 URL」的**唯一数据结构定义**，
 * 构建期与 dev 中间件共用同一份，保证两条路径产出完全一致。
 *
 * 刻意**不引用任何 Node 或 Vite 类型**：`types.ts` 里的注释已经定过这条纪律
 * （全站共享类型不得依赖运行期专属 API），这里沿用，将来若要让编辑器
 * 也能读同一份契约，不需要再拆一遍。
 */

/** 管线所处的模式。决定"何时转码"，不影响任何命名规则。 */
export type MediaMode = 'dev' | 'build'

/** 源图的处理方式。 */
export type MediaKind =
  /** 位图：png / jpg / jpeg / webp / avif，转成多档 webp。 */
  | 'raster'
  /** 矢量：svg，不转码，原样引用（栅格化是降级）。 */
  | 'vector'
  /** 动图：gif，不转码，保留动效（静帧化会被当成「图坏了」）。 */
  | 'animated'

/** 一档展示变体。 */
export interface MediaVariant {
  /** 目标宽度（px）。 */
  width: number
  /** 产物内的文件路径，相对产物根，如 `assets/media/ab12cd34ef56-672.webp`。 */
  fileName: string
  /** 编码后字节数；dev 下按需转码前是 0。 */
  bytes: number
}

/** 一张源图的完整解析结果。 */
export interface MediaEntry {
  /** 源文件字节的 sha256（完整 64 位十六进制）。跨文章、跨语言去重就靠它。 */
  key: string
  /** 源文件绝对路径。 */
  sourcePath: string
  /** 小写扩展名，不含点。 */
  ext: string
  kind: MediaKind
  /** 源图固有宽度（px）。 */
  intrinsicWidth: number
  /** 源图固有高度（px）。 */
  intrinsicHeight: number
  /** 原图在产物内的路径（无条件进产物，用于放大查看与下载）。`public/` 资源为 `null`（不重复发射）。 */
  originFileName: string | null
  /** 原图字节数。 */
  originBytes: number
  /**
   * LQIP（模糊缩略图）的文件名，相对产物根，如 `assets/media/ab12-lqip.webp`。
   *
   * 构建期 / dev 转码后字节会放进 `files`，`markupOf` 读出来 base64
   * 内联进 `<img data-lqip>`。矢量、窄图、转码失败时为 `null`
   * （渲染侧据此跳过占位，行为退回无 LQIP 的版本）。
   */
  lqipFileName: string | null
  /** 展示变体，按宽度升序。矢量与动图为空数组（直接用原图）。 */
  variants: MediaVariant[]
  /** 文件名 → 字节。构建期在扫描阶段填满；dev 下按需填充。 */
  files: Map<string, Buffer>
}
