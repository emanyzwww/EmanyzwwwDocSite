/**
 * dev server 的根路径语言跳转（仅开发期生效）。
 *
 * 生产构建时，根路径 `/` 由 `docs/public/index.html` 承担跳转，靠浏览器端的
 * `navigator.languages` + `localStorage` 判断。但 dev server 里 `/` 会被 Vite
 * 当作 SPA 入口接管，`public/index.html` 不会生效，页面会是一片空白。
 *
 * 这里用同一个「按浏览器语言挑一个」的规则，在 dev 阶段直接返回 302，
 * 让本地开发与线上行为一致（区别只是判断依据来自 `Accept-Language` 请求头）。
 */

import type { Plugin } from 'vitepress'

import { asLocale, DEFAULT_LOCALE, LOCALE_CODES } from '../data/site'

/** `zh-CN,zh;q=0.9,en;q=0.8` → `zh-cn`；匹配不上时返回默认语言。 */
export function pickLocale(acceptLanguage: string | undefined): string {
  const tags = String(acceptLanguage ?? '')
    .split(',')
    .map((part) => part.split(';')[0]?.trim().toLowerCase() ?? '')
    .filter(Boolean)

  for (const tag of tags) {
    // `zh`、`zh-cn`、`zh-hans-cn` 都归到简体中文站
    if (tag.startsWith('zh')) return 'zh-cn'
    if (tag.startsWith('en')) return 'en'
    const exact = asLocale(tag)
    if (LOCALE_CODES.includes(exact) && tag === exact) return exact
  }

  return DEFAULT_LOCALE
}

/** 把 `/`（以及 `/index.html`）重定向到语言首页。 */
export function devRootRedirect(base: string): Plugin {
  const rootPaths = new Set([base, `${base}index.html`])

  return {
    name: 'local:dev-root-redirect',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0] ?? ''
        if (!rootPaths.has(path)) return next()

        res.statusCode = 302
        res.setHeader('Location', `${base}${pickLocale(req.headers['accept-language'])}/`)
        res.end()
      })
    },
  } satisfies Plugin
}
