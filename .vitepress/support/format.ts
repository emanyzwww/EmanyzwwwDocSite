/**
 * 纯函数格式化工具。
 *
 * 同时被构建期（数据加载器 / RSS）与运行期（组件）使用，
 * 因此不依赖任何 Node 或浏览器 API（`Intl` 在两端都可用）。
 */

import type { LocaleCode } from '../types'

/** 英文月份缩写，避免依赖构建机的 ICU 数据导致输出不稳定。 */
const EN_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

interface DateParts {
  year: string
  month: string
  day: string
}

/**
 * 按指定时区拆分日期。
 * 用 `Intl` 而不是 `getFullYear()`，保证构建机时区不同也不会跨日。
 */
export function splitDate(date: Date, timeZone: string): DateParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? ''

  return { year: pick('year'), month: pick('month'), day: pick('day') }
}

/** 解析 frontmatter 里的日期：可能是 `Date`，也可能是字符串。 */
export function parseDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  return null
}

/** 完整日期：中文 `2026 年 10 月 19 日`，英文 `Oct 19, 2026`。 */
export function formatDate(date: Date, locale: LocaleCode, timeZone: string): string {
  const { year, month, day } = splitDate(date, timeZone)
  if (locale === 'en') {
    return `${EN_MONTHS[Number(month) - 1] ?? month} ${Number(day)}, ${year}`
  }
  return `${year} 年 ${month} 月 ${day} 日`
}

/** 短日期：`MM-DD`，用于时间线左侧。 */
export function formatShortDate(date: Date, timeZone: string): string {
  const { month, day } = splitDate(date, timeZone)
  return `${month}-${day}`
}

/** 年份：`YYYY`，用于时间线分组。 */
export function formatYear(date: Date, timeZone: string): string {
  return splitDate(date, timeZone).year
}

/** 日期部分：`YYYY-MM-DD`（按站点时区，用于 `<time datetime>`）。 */
export function formatIsoDate(date: Date, timeZone: string): string {
  const { year, month, day } = splitDate(date, timeZone)
  return `${year}-${month}-${day}`
}

/**
 * RFC 822 时间串，用于 RSS 的 `pubDate` / `lastBuildDate`。
 *
 * 关键点：日期、时间、时区偏移**必须来自同一个时刻表示**。
 * 之前这里日期按站点时区算、时分秒却取 `getUTC*()`，两者混用会得到
 * 自相矛盾的串（例如「19 日」配「20:09 UTC」，实际是 18 日 20:09 UTC）。
 *
 * 现在统一用 UTC：`toUTCString()` 给出的就是 RFC 822 兼容格式
 * （`Sun, 18 Oct 2026 20:09:28 GMT`），只需把 `GMT` 换成 `+0000`。
 * 这样无论构建机时区如何，输出的都是同一个绝对时刻。
 */
export function formatRfc822(date: Date, _timeZone: string): string {
  return date.toUTCString().replace(/GMT$/, '+0000')
}

/**
 * 把 Markdown 压成纯文本，用于摘要与字数统计。
 *
 * 只去掉「语法标记」，保留正文文字（包括代码块内容），
 * 与旧站按渲染后纯文本计数的口径保持一致。
 */
export function plainText(markdown: string): string {
  return markdown
    .replace(/^---[\s\S]*?---\s*/, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/^\s*```.*$/gm, ' ')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 字数统计：汉字按字计，拉丁字母/数字按词计。
 *
 * 不用 `String#length` 或按空格切词：中文没有空格，
 * 按空格切会把整段汉字算成 1 个词（Hugo 的 `WordCount` 就是这个行为）。
 */
export function countWords(markdown: string): number {
  const text = plainText(markdown)
  const han = text.match(/\p{Script=Han}/gu)?.length ?? 0
  const latin = text.match(/[A-Za-z0-9]+/g)?.length ?? 0
  return han + latin
}

/** 截断到指定长度，超出部分用省略号代替。 */
export function truncate(text: string, maxLength: number): string {
  const normalized = text.trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength).trimEnd()}…`
}

/** 取正文第一段纯文本，作为没有 `description` 时的兜底摘要。 */
export function firstParagraph(markdown: string): string {
  const body = markdown.replace(/^---[\s\S]*?---\s*/, '')
  const block = body
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .find((part) => part.length > 0 && !part.startsWith('#') && !part.startsWith('```'))

  return block ? plainText(block) : ''
}
