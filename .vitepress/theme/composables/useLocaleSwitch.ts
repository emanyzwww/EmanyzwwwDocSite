/**
 * 语言切换。
 *
 * 规则（比旧站更明确）：
 * 1. 目标语言存在**完全对应**的页面 → 直达；
 * 2. 否则退到目标语言的**同栏目索引**（如 `/en/posts/`）；
 * 3. 再不行退到目标语言的**首页**。
 *
 * 「页面是否存在」由构建期生成的 `pages.data.ts` 决定，不做字符串猜测。
 * 两种语言地位对等，都是 `/zh-cn/`、`/en/` 这样的前缀。
 */

import { useData, useRoute } from 'vitepress'
import { computed } from 'vue'

import { data as pages } from '../../data/pages.data'
import { asLocale, LOCALE_CODES, LOCALES } from '../../data/site'
import type { LocaleCode } from '../../types'
import { stripLocale, stripRouteBase, withLocale } from '../support/paths'

export interface LocaleOption {
  code: LocaleCode
  label: string
  lang: string
  url: string
  current: boolean
}

/** 页面存在性索引（存的是编码后的 URL，与 `RawDoc.url` 一致）。 */
const knownPages = new Set(pages.urls)

export function useLocaleSwitch() {
  const route = useRoute()
  const { localeIndex } = useData()

  const current = computed<LocaleCode>(() => asLocale(localeIndex.value))

  /** 任意语言的入口列表（含当前语言，供下拉菜单渲染）。 */
  const options = computed<LocaleOption[]>(() => {
    /*
     * 两步剥离，顺序不能反：
     * 1. `stripRouteBase` 去掉部署 base（`/repo/zh-cn/about/` → `/zh-cn/about/`）。
     *    `route.path` 是**含 base** 的，而 `knownPages` 里全是**不含 base** 的
     *    站点路径，不减这一步的话下面三级回退会全部失配、永远落到语言首页。
     * 2. `stripLocale` 去掉语言前缀（`/zh-cn/about/` → `/about/`）。
     */
    const bare = stripLocale(stripRouteBase(route.path))

    return LOCALE_CODES.map((code) => {
      const meta = LOCALES[code]
      return {
        code,
        label: meta.label,
        lang: meta.lang,
        // 当前语言直接用 `route.path`（已含 base，可直接当 href）
        url: code === current.value ? route.path : resolveTarget(bare, code),
        current: code === current.value,
      }
    })
  })

  return { current, options }
}

/**
 * 按上面三条规则推导目标地址。
 *
 * 比较时统一编码：`knownPages` 存的是 `encodeURI` 后的形式，
 * 而 `route.path` 在浏览器里已经是编码后的（中文标签页会是 `%E9%9A%8F...`）。
 */
function resolveTarget(bare: string, locale: LocaleCode): string {
  // 1. 完全对应的页面
  const exact = withLocale(bare, locale)
  if (knownPages.has(exact)) return exact

  // 2. 同栏目索引：`/posts/hello-world/` → `/posts/`
  const segments = bare.split('/').filter(Boolean)
  if (segments.length > 1) {
    const section = withLocale(`/${segments[0]}/`, locale)
    if (knownPages.has(section)) return section
  }

  // 3. 语言首页
  return withLocale('/', locale)
}
