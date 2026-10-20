/**
 * 文案入口与插值工具。
 *
 * 用法：
 *   const { m, locale } = useI18n()
 *   m.value.tags                       // 直接取
 *   format(m.value.termCount, { count: 3 })  // 带占位符
 */

import { useData } from 'vitepress'
import { computed } from 'vue'

import { asLocale } from '../../data/site'
import type { LocaleCode, Messages } from '../../types'
import { en } from './en'
import { zhCN } from './zh-cn'

/** 语言 → 文案表。新增语言时在这里补一条。 */
export const MESSAGES: Record<LocaleCode, Messages> = {
  'zh-cn': zhCN,
  en,
}

/** 把 `{name}` 占位符替换成实际值。 */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  )
}

/**
 * 当前页面的语言与文案。
 *
 * 语言判定沿用 VitePress 的 `localeIndex`（由页面路径前缀决定），
 * 因此 `/en/...` 得到 `en`，`/zh-cn/...` 得到 `zh-cn`。
 * 根路径 `/` 只是语言重定向页，正常不会渲染主题。
 */
export function useI18n() {
  const { localeIndex } = useData()

  const locale = computed<LocaleCode>(() => asLocale(localeIndex.value))
  const m = computed<Messages>(() => MESSAGES[locale.value])

  return { locale, m }
}
