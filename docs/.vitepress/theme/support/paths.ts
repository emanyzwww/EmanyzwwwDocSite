/**
 * 路径工具。
 *
 * 全站只在这里处理「相对路径 ↔ 站点路径 ↔ 语言前缀」的换算，
 * 避免每个组件各写一份字符串替换导致边界情况不一致。
 */

import { withBase } from 'vitepress'

import type { LocaleCode } from '../../types'

/** `posts/hello-world/index.md` → `/posts/hello-world/`。 */
export function toPageUrl(relativePath: string): string {
  const withoutExt = relativePath.replace(/\.md$/, '')
  const withoutIndex = withoutExt.replace(/(^|\/)index$/, '$1')
  return `/${withoutIndex}`.replace(/\/{2,}/g, '/').replace(/\/?$/, '/')
}

/** 路径属于哪种语言：以 `/en/` 开头即英文站。 */
export function localeOfPath(path: string): LocaleCode {
  return /^\/en(\/|$)/.test(path) ? 'en' : 'root'
}

/** 去掉语言前缀：`/en/posts/` → `/posts/`。 */
export function stripLocale(path: string): string {
  const stripped = path.replace(/^\/en(?=\/|$)/, '')
  return stripped || '/'
}

/** 加上语言前缀：`/posts/` + `en` → `/en/posts/`。 */
export function withLocale(path: string, locale: LocaleCode): string {
  if (locale === 'root') return path
  return path === '/' ? '/en/' : `/en${path}`
}

/** 文章列表页地址：第 1 页是 `/posts/`，其余是 `/posts/page/N/`。 */
export function postListUrl(locale: LocaleCode, page = 1): string {
  const base = page <= 1 ? '/posts/' : `/posts/page/${page}/`
  return withBase(withLocale(base, locale))
}

/** 给站内绝对路径加上部署 base，用于 `href`。 */
export function href(path: string): string {
  return /^(https?:)?\/\//.test(path) || path.startsWith('mailto:') ? path : withBase(path)
}

/**
 * 语言切换用的地址。
 *
 * 语言路径索引里存的是**不含 base** 的站点路径，渲染时必须补上 base，
 * 否则部署到 GitHub Pages 项目站点（`/repo/`）时会跳到域名根。
 */
export function localizedHref(path: string): string {
  return withBase(path)
}

/** 是否为外部链接（决定要不要新窗口打开）。 */
export function isExternal(path: string): boolean {
  return /^(https?:)?\/\//.test(path)
}
