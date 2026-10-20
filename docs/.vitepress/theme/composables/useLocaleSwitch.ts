/**
 * 语言切换。
 *
 * 规则（比旧站更明确）：
 * 1. 目标语言存在**完全对应**的页面 → 直达；
 * 2. 否则退到目标语言的**同栏目索引**（如 `/en/posts/`）；
 * 3. 再不行退到目标语言的**首页**。
 *
 * 「页面是否存在」由构建期生成的 `pages.data.ts` 决定，不做字符串猜测。
 */

import { useData, useRoute } from 'vitepress'
import { computed } from 'vue'

import { data as pages } from '../../data/pages.data'
import { LOCALES } from '../../data/site'
import type { LocaleCode } from '../../types'
import { stripLocale, withLocale } from '../support/paths'

export interface LocaleOption {
  code: LocaleCode
  label: string
  lang: string
  url: string
  current: boolean
}

/** 页面存在性索引。 */
const knownPages = new Set(pages.urls)

export function useLocaleSwitch() {
  const route = useRoute()
  const { localeIndex } = useData()

  const current = computed<LocaleCode>(() => (localeIndex.value === 'en' ? 'en' : 'root'))

  /** 任意语言的入口列表（含当前语言，供下拉菜单渲染）。 */
  const options = computed<LocaleOption[]>(() => {
    const bare = stripLocale(route.path)

    return (Object.keys(LOCALES) as LocaleCode[]).map((code) => {
      const meta = LOCALES[code]
      return {
        code,
        label: meta.label,
        lang: meta.lang,
        url: code === current.value ? route.path : resolveTarget(bare, code),
        current: code === current.value,
      }
    })
  })

  return { current, options }
}

/** 按上面三条规则推导目标地址。 */
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
