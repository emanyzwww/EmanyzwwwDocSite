/**
 * 语言前缀换算（纯函数，无框架依赖）。
 *
 * 与 `urls.ts` 一样，这里刻意不 import `vitepress`：
 * 构建期（`config.ts`）与测试都直接用它，需要 `withBase` 的地方在
 * `theme/support/paths.ts` 里再包一层。
 */

import { asLocale, LOCALE_CODES } from '../data/site'
import type { LocaleCode } from '../types'

/** 路径属于哪种语言：第一段就是语言，匹配不上时归默认语言。 */
export function localeOfPath(path: string): LocaleCode {
  return asLocale(path.split('/').find(Boolean))
}

/** 去掉语言前缀：`/en/posts/` → `/posts/`，`/zh-cn/` → `/`。 */
export function stripLocale(path: string): string {
  const stripped = path.replace(new RegExp(`^/(?:${LOCALE_CODES.join('|')})(?=/|$)`), '')
  return stripped || '/'
}

/**
 * 去掉部署 base：`/repo/zh-cn/about/` + `/repo/` → `/zh-cn/about/`。
 *
 * **必须在 `stripLocale` 之前调用**，这不是可选的顺序问题：
 * VitePress 的 `route.path` 在浏览器里**含 base**
 * （`client/app/router.js` 是 `route.path = withBase(pendingPath)`），
 * 而站点内所有内容路径（`pages.data.ts` 的 `readPageUrls()`、`TagRef.url`、
 * canonical）都**不含 base**。两者直接比较永远不相等。
 *
 * 这个坑只在「部署到子路径」时才暴露（GitHub Pages 项目站点 `base=/<repo>/`）。
 * 本地 `pnpm dev` 的 base 是 `/`，此时 `stripBase` 是恒等函数，
 * 所以本地开发永远看不出问题——这正是它长期没被发现的原因。
 *
 * @param path 可能带 base 的路径，如 `/repo/zh-cn/about/`
 * @param base 部署 base，必须以 `/` 开头和结尾，如 `/repo/`
 */
export function stripBase(path: string, base: string): string {
  // 根部署（base 为 `/`）无需处理
  if (!base || base === '/') return path

  const prefix = base.endsWith('/') ? base.slice(0, -1) : base
  if (path === prefix) return '/'

  return path.startsWith(`${prefix}/`) ? path.slice(prefix.length) : path
}

/** 加上语言前缀：`/posts/` + `en` → `/en/posts/`，`/` + `zh-cn` → `/zh-cn/`。 */
export function withLocale(path: string, locale: LocaleCode): string {
  return path === '/' ? `/${locale}/` : `/${locale}${path}`
}

/** 当前语言的订阅源地址（不含 base）：`/zh-cn/index.xml`、`/en/index.xml`。 */
export function feedPath(locale: LocaleCode): string {
  return `/${locale}/index.xml`
}

/** 是否为外部链接（决定要不要新窗口打开）。 */
export function isExternal(path: string): boolean {
  return /^(https?:)?\/\//.test(path)
}

/** 文章列表页地址（不含 base）：第 1 页是 `/posts/`，其余是 `/posts/page/N/`。 */
export function postListPath(locale: LocaleCode, page = 1): string {
  const base = page <= 1 ? '/posts/' : `/posts/page/${page}/`
  return withLocale(base, locale)
}
