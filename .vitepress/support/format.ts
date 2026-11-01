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
 * 更新日期的展示文本：**同年用 `MM-DD`，跨年才带 `YYYY-`**。
 *
 * 为什么不是完整日期：meta 行里已经有一个完整发布日，更新日只需要
 * 「晚多少」的精度；跨年时必须带年份，否则 `01-02` 会被读成去年的 1 月 2 日。
 */
export function formatUpdatedDate(date: Date, timeZone: string, referenceYear: string): string {
  const { year, month, day } = splitDate(date, timeZone)
  return year === referenceYear ? `${month}-${day}` : `${year}-${month}-${day}`
}

/**
 * 这次更新值不值得显示。
 *
 * 规则：**只有更新日（站点时区的日期部分）晚于发布日才算「更新」**。
 * - 同一天改错字不显示：那只会让每篇刚发布的文章都挂上「更新于」；
 * - `updated` 早于 `date`（作者写错）不显示：不能让文章显示「先更新后发布」。
 */
export function isMeaningfulUpdate(
  published: Date,
  updated: Date | null,
  timeZone: string,
): updated is Date {
  if (!updated) return false
  return formatIsoDate(updated, timeZone) > formatIsoDate(published, timeZone)
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
 * 正文的字符构成：汉字数 + 拉丁词数。
 *
 * `countWords`（字数）与 `readingMinutes`（阅读时长）共用这一份切分规则：
 * 中文没有词间空格，两种统计必须从同一个口径出发，否则「504 字」与
 * 「约 2 分钟」会互相打架。
 */
export function textStats(markdown: string): { han: number; latin: number } {
  const text = plainText(markdown)
  return {
    han: text.match(/\p{Script=Han}/gu)?.length ?? 0,
    latin: text.match(/[A-Za-z0-9]+/g)?.length ?? 0,
  }
}

/**
 * 字数统计：汉字按字计，拉丁字母/数字按词计。
 *
 * 不用 `String#length` 或按空格切词：中文没有空格，
 * 按空格切会把整段汉字算成 1 个词（Hugo 的 `WordCount` 就是这个行为）。
 */
export function countWords(markdown: string): number {
  const { han, latin } = textStats(markdown)
  return han + latin
}

/**
 * 阅读时长（分钟，最小 1）。
 *
 * 口径：中文 **350 字/分**、拉丁 **200 词/分**（常见的阅读速度中位数）。
 * 不含代码行的额外权重——本站代码块大多是短片段，单独加权只会让
 * 「10 行代码」被算成 1 分钟，反而失真。
 *
 * 四舍五入到整分钟；不足 1 分钟按 1 分钟算（读者的感知下限不是 0）。
 */
export function readingMinutes(markdown: string): number {
  const { han, latin } = textStats(markdown)
  return Math.max(1, Math.round(han / 350 + latin / 200))
}

/**
 * 比较「两段文字是不是同一句」用的归一化：去掉所有标点、符号与空白，并小写。
 *
 * 文章页的导语与正文首段常常是同一句话，只是标点写法不同
 * （description 里写 `「hello, world」`，正文里写 `“hello, world”`）。
 * 直接字符串比较会漏判，于是同一句话在标题下出现两次。
 */
export function normalizeComparable(text: string): string {
  return text.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase()
}

/**
 * 这段导语是否**已经出现在正文开头**（等于或互为前缀）。
 *
 * 相等或前缀关系都算重复：描述常常就是正文的第一句，再贴一次没有信息量。
 */
export function isDuplicateOpening(lead: string, firstParagraphText: string): boolean {
  const a = normalizeComparable(lead)
  const b = normalizeComparable(firstParagraphText)
  if (!a || !b) return false
  return a === b || b.startsWith(a) || a.startsWith(b)
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
