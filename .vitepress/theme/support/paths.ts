/**
 * 路径工具（运行期入口）。
 *
 * 纯换算逻辑在 `support/urls.ts` 与 `support/locale-paths.ts`，
 * 这里只做两件事：
 * 1. 原样转出纯函数，组件统一从本文件 import；
 * 2. 给需要 `base` 的地址包一层 `withBase`（只有浏览器侧才需要）。
 *
 * 拆开的原因：纯函数要能在 Node 里单测，而 `vitepress` 的 `withBase`
 * 依赖站点数据，在测试环境里不可用。
 */

import { withBase } from 'vitepress'

export {
  feedPath,
  isExternal,
  localeOfPath,
  postListPath,
  stripLocale,
  tagIndexPath,
  withLocale,
} from '../../support/locale-paths'
export { decodePath, toPageUrl } from '../../support/urls'

import { postListPath, stripBase } from '../../support/locale-paths'
import type { LocaleCode } from '../../types'

/**
 * 部署 base，形如 `/repo/`（根部署时是 `/`）。
 *
 * 用 Vite 的 `BASE_URL` 而不是 `site.value.base`：前者是构建期常量，
 * 可以在**任何**模块（含非组件的纯函数、单测替身）里直接用，不需要 `useData()`。
 * VitePress 会把配置里的 `base` 同步写进 Vite 配置，两者始终一致。
 */
export const BASE_URL: string = import.meta.env.BASE_URL || '/'

/**
 * 把 VitePress 的 `route.path` 规整成「不含 base 的站点路径」。
 *
 * 存在的唯一理由是：`route.path` **含 base**，而内容路径都不含。
 * 所有「拿 route.path 和站点路径比较」的地方都必须先过这一道，
 * 否则在 GitHub Pages 项目站点上全部失配（语言切换退回首页、导航高亮失效）。
 */
export function stripRouteBase(path: string): string {
  return stripBase(path, BASE_URL)
}

/** 文章列表页地址：第 1 页是 `/pages/posts/`，其余是 `/pages/posts/page/N/`（已带 base）。 */
export function postListUrl(locale: LocaleCode, page = 1): string {
  return withBase(postListPath(locale, page))
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
