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
