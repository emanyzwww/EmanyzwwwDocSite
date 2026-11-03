/**
 * 全局过滤参数：`-l/--lang`、`-d/--date`、`-t/--tag`。
 *
 * 三个参数在 `list` / `check` / `fix` / `format` 里语义相同，因此解析与匹配
 * 只在这里实现一次；各命令只负责把结果拼进自己的输出。
 *
 * 语言是**严格匹配**的：只接受 `zh-cn`、`en`（区分大小写），不做
 * `zh` / `cn` / `en-us` 之类的模糊兼容——写错就直接报错，避免静默落到默认语言。
 */

import type { LocaleCode } from '../../.vitepress/types'
import { nowInZone } from './dates'
import type { PostFile } from './posts'
import { LOCALE_CODES, SITE_TIME_ZONE } from './site'

/** 日期区间：比较键是「目录日期 + 当日序号」。 */
export interface DateRange {
  lower: { dateKey: string; sequence: string }
  upper: { dateKey: string; sequence: string }
}

/** 已解析的 `-d`：多个区间取并集。 */
export interface DateFilter {
  ranges: DateRange[]
  /** 用户原始输入，用于提示与回显。 */
  text: string
}

/** 标签过滤条件。 */
export interface TagFilter {
  tags: string[]
}

/** `-t` 的三种形态。 */
export type TagOption = { mode: 'none' } | { mode: 'bare' } | { mode: 'some'; tags: string[] }

/** 一次命令调用的全局范围。 */
export interface Scope {
  /** `undefined` = 全部语言。 */
  locales: LocaleCode[] | undefined
  /** `undefined` = 全部日期。 */
  date: DateFilter | undefined
  tag: TagOption
}

/** `new` 的日期：精确到日（可选当日序号）。 */
export interface NewDateParts {
  year: string
  month: string
  day: string
  sequence: string | undefined
}

/** 两位补零。 */
function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** 某年某月有几天（用 UTC 避免运行机时区影响）。 */
function lastDayOfMonth(year: string, month: string): number {
  return new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate()
}

/**
 * 解析一个日期前缀：`2026` / `202611` / `20261101` / `2026110101`。
 *
 * 返回它覆盖的键区间；同时校验月份、日期、序号是否真实存在——
 * `20260230` 这种「位数对但不存在的日期」必须报错，而不是被 Date 悄悄滚到 3 月。
 */
function parseDateSpec(token: string): DateRange {
  const example = '2026、202611、20261101、2026110101、202601..202606'
  if (!/^\d+$/.test(token) || ![4, 6, 8, 10].includes(token.length)) {
    throw new Error(`日期写法不对：${token}（可用 ${example}）`)
  }

  const year = token.slice(0, 4)
  if (year === '0000') {
    throw new Error(`年份不合法：${token}`)
  }

  if (token.length === 4) {
    return {
      lower: { dateKey: `${year}0101`, sequence: '01' },
      upper: { dateKey: `${year}1231`, sequence: '99' },
    }
  }

  const month = token.slice(4, 6)
  const monthNumber = Number(month)
  if (monthNumber < 1 || monthNumber > 12) {
    throw new Error(`月份不合法：${token}（01–12）`)
  }
  const maxDay = lastDayOfMonth(year, month)

  if (token.length === 6) {
    return {
      lower: { dateKey: `${year}${month}01`, sequence: '01' },
      upper: { dateKey: `${year}${month}${pad2(maxDay)}`, sequence: '99' },
    }
  }

  const day = token.slice(6, 8)
  const dayNumber = Number(day)
  if (dayNumber < 1 || dayNumber > maxDay) {
    throw new Error(`日期不合法：${token}（${year} 年 ${month} 月只有 ${maxDay} 天）`)
  }

  const dateKey = `${year}${month}${day}`
  if (token.length === 8) {
    return {
      lower: { dateKey, sequence: '01' },
      upper: { dateKey, sequence: '99' },
    }
  }

  const sequence = token.slice(8, 10)
  const sequenceNumber = Number(sequence)
  if (sequenceNumber < 1 || sequenceNumber > 99) {
    throw new Error(`当日序号不合法：${token}（01–99）`)
  }
  return {
    lower: { dateKey, sequence },
    upper: { dateKey, sequence },
  }
}

/**
 * 解析 `-d`：支持 `2026`、`202611`、`20261101`、`2026110101`、
 * 区间 `202601..202606`，以及逗号并集 `202601,202603`。
 *
 * `undefined` 表示不过滤；空串 / 无法解析的片段直接报错。
 */
export function parseDateFilter(value: string | undefined): DateFilter | undefined {
  if (value === undefined) return undefined

  const text = value.trim()
  if (text === '') {
    throw new Error('--date 需要值，例如 -d=2026、-d=20261101 或 -d=202601..202606')
  }

  const ranges: DateRange[] = []
  for (const chunk of text.split(',')) {
    const part = chunk.trim()
    if (part === '') {
      throw new Error(`--date 里有空的日期片段：${text}`)
    }

    const pieces = part.split('..')
    if (pieces.length > 2) {
      throw new Error(`--date 的区间只能有一个 ".."：${part}`)
    }

    const lower = parseDateSpec(pieces[0] ?? '')
    const upper = pieces[1] === undefined ? lower : parseDateSpec(pieces[1])
    if (lower.lower.dateKey > upper.upper.dateKey) {
      throw new Error(`--date 区间起点晚于终点：${part}`)
    }
    ranges.push({ lower: lower.lower, upper: upper.upper })
  }

  return { ranges, text }
}

/**
 * 解析 `new` 的 `-d`：只接受 8 位（精确到日）或 10 位（精确到篇）。
 *
 * 不写时用站点时区的「今天」。
 */
export function parseNewDate(value: string | undefined, now: Date = new Date()): NewDateParts {
  if (value === undefined) {
    const parts = nowInZone(SITE_TIME_ZONE, now)
    return { year: parts.year, month: parts.month, day: parts.day, sequence: undefined }
  }

  const text = value.trim()
  if (!/^\d{8}$/.test(text) && !/^\d{10}$/.test(text)) {
    throw new Error(
      `new 的 --date 需要精确到日（8 位 YYYYMMDD）或篇（10 位 YYYYMMDDNN），` +
        `例如 20261024 / 2026102401；收到：${value}`,
    )
  }

  const range = parseDateSpec(text)
  const dateKey = range.lower.dateKey
  return {
    year: dateKey.slice(0, 4),
    month: dateKey.slice(4, 6),
    day: dateKey.slice(6, 8),
    sequence: text.length === 10 ? range.lower.sequence : undefined,
  }
}

/** 解析标签值：逗号（中英文）分隔，去空白、去空项、去重。 */
export function parseTagList(value: string): string[] {
  const tags = value
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '')

  if (tags.length === 0) {
    throw new Error('--tag 的值为空，例如 -t=随笔 或 -t=随笔,工具')
  }
  return [...new Set(tags)]
}

/** 文章 frontmatter 里的标签（只取字符串项）。 */
export function tagsOfPost(post: PostFile): string[] {
  const value = post.data.tags
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string').map((tag) => tag.trim())
}

/** 判断文章是否落在日期过滤范围内。 */
export function matchesDate(post: PostFile, filter: DateFilter): boolean {
  if (!post.path.compliant) return false
  const key = `${post.path.dateKey}:${post.path.sequence}`
  return filter.ranges.some((range) => {
    const lower = `${range.lower.dateKey}:${range.lower.sequence}`
    const upper = `${range.upper.dateKey}:${range.upper.sequence}`
    return key >= lower && key <= upper
  })
}

/** 判断文章是否符合全局范围（语言 / 日期 / 标签）。 */
export function matchesScope(post: PostFile, scope: Scope): boolean {
  if (scope.locales && !scope.locales.includes(post.path.locale)) return false
  if (scope.date && !matchesDate(post, scope.date)) return false

  if (scope.tag.mode === 'some') {
    const tags = tagsOfPost(post)
    if (!scope.tag.tags.some((tag) => tags.includes(tag))) return false
  }

  return true
}

/** 把范围描述成一句人话，用于列表/检查结果的标题。 */
export function scopeSummary(scope: Scope): string {
  const parts: string[] = []
  parts.push(scope.locales ? scope.locales.join('、') : '全部语言')
  if (scope.date) parts.push(scope.date.text)
  if (scope.tag.mode === 'some') parts.push(`标签 ${scope.tag.tags.join('、')}`)
  return parts.join(' · ')
}

/** 语言名（用于提示）。 */
export function localeLabel(locale: LocaleCode): string {
  return locale === 'zh-cn' ? '简体中文' : 'English'
}

/** 全部合法语言代码（按站点顺序）。 */
export function allLocales(): LocaleCode[] {
  return [...LOCALE_CODES]
}
