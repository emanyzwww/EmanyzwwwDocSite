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

import type { LocaleCode, Messages } from '../../types'
import { en } from './en'
import { zhCN } from './zh-cn'

/** 语言 → 文案表。新增语言时在这里补一条。 */
export const MESSAGES: Record<LocaleCode, Messages> = {
  root: zhCN,
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
 * 因此 `/en/...` 自动得到 `en`，其余为默认语言 `root`。
 */
export function useI18n() {
  const { localeIndex } = useData()

  const locale = computed<LocaleCode>(() => (localeIndex.value === 'en' ? 'en' : 'root'))
  const m = computed<Messages>(() => MESSAGES[locale.value])

  return { locale, m }
}
