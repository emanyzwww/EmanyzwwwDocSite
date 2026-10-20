/**
 * 纯路径函数（无任何框架或 Node 依赖）。
 *
 * 这个文件是**构建期与运行期共用的唯一实现**：
 * `config.ts`（SEO / sitemap）、`support/content.ts`（内容扫描）、
 * `theme/support/paths.ts`（组件 href）都从这里取，避免同一套换算被抄成四份。
 *
 * 之前四份实现的差异（是否补结尾斜杠、是否 URL 编码）直接导致了
 * canonical 与 sitemap 对同一个中文标签页给出两种 URL，因此这里定死规则。
 *
 * 编码约定：
 * - **内部一律用原文**：`TagRef.slug`、路由参数、页面索引都是 `随笔` 这样的原文；
 * - **只在产出 URL 时编码**：由本文件的 `toPageUrl()` 统一负责。
 */

/**
 * 源文件相对路径 → 站点路径（已 URL 编码、结尾带斜杠）。
 *
 * `zh-cn/posts/2026/10/19/01/hello-world/index.md`
 *   → `/zh-cn/posts/2026/10/19/01/hello-world/`
 * `zh-cn/tags/随笔/index.md` → `/zh-cn/tags/%E9%9A%8F%E7%AC%94/`
 *
 * 用 `encodeURI` 而不是 `encodeURIComponent`：路径分隔符 `/` 必须保留。
 */
export function toPageUrl(relativePath: string): string {
  const withoutExt = relativePath.replace(/\.md$/, '')
  const withoutIndex = withoutExt.replace(/(^|\/)index$/, '$1')
  const normalized = `/${withoutIndex}`.replace(/\/{2,}/g, '/').replace(/\/?$/, '/')
  return encodeURI(normalized)
}

/** 把可能已编码的路径解码成原文，用于和 slug / 路由参数比较。 */
export function decodePath(path: string): string {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}
