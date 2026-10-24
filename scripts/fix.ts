/**
 * `pnpm fix` —— 自动修复 `check` 报告里能安全自动处理的问题。
 *
 * 「安全」的边界（宁可少修，不可改错）：
 * - ✅ 重排 frontmatter 字段顺序
 * - ✅ 补齐缺失的**可选**字段（tags / description / draft / outline）
 * - ✅ 把裸日期补成带时区的完整格式
 * - ✅ 规范化标签（去空白、去空项、去重，保持原顺序）
 * - ❌ 不改标题、不改正文、不改目录名、不删废弃字段
 *
 * 标题与正文是创作内容，目录名会影响 URL；这些改错了没有撤销按钮。
 * 废弃字段与未知字段同理——留给作者判断。
 */

import { writeFileSync } from 'node:fs'

import { hasOption, optionValue, parseArgs, wantsHelp } from './lib/args'
import { formatZonedIso } from './lib/dates'
import { stringifyFrontmatter, rawScalarValue } from './lib/frontmatter'
import { collectPostFiles, postDate } from './lib/posts'
import type { PostFile } from './lib/posts'
import { parseLocale } from './lib/site'
import { SITE_TIME_ZONE } from './lib/site'
import { blank, c, helpLines, info, success, warn } from './lib/ui'

/** 选项定义。 */
const SPECS = [
  { name: 'lang', short: 'l' },
  { name: 'dry-run', boolean: true },
  { name: 'help', short: 'h', boolean: true },
] as const

/** 帮助。 */
function printHelp(): void {
  helpLines(
    'pnpm fix',
    'pnpm fix [选项]',
    [
      { flag: '-l, --lang <code>', description: '只处理某种语言（默认全部）' },
      { flag: '--dry-run', description: '只显示会改什么，不写盘' },
      { flag: '-h, --help', description: '显示本帮助' },
    ],
    ['pnpm fix', 'pnpm fix --dry-run', 'pnpm fix -l=zh-cn'],
  )
}

/** 一次修复的结果。 */
interface FixResult {
  file: string
  changes: string[]
  content: string
}

/**
 * 把 `date` 规范成带时区的完整格式。
 *
 * **必须基于文件里的原始字面量判断**，而不是 `gray-matter` 解析后的值：
 * 解析结果永远是 `Date` 对象，`2026-10-19T04:09:28+08:00` 与
 * `2026-10-19` 在解析后长得一模一样，从而无法区分「已合规」与「需要修」。
 * 早期按解析值判断，导致 `fix` 把每个文件都当成需要修复并全部重写。
 */
function normalizeDate(post: PostFile): { value: string; changed: boolean } {
  // 文件里原样写了什么
  const literal = rawScalarValue(post.raw, 'date')
  const parsed = postDate(post)

  // 字面量缺失或无法解析：只在能确定时刻时才补
  if (literal === undefined || literal === '') {
    return parsed
      ? { value: formatZonedIso(parsed, SITE_TIME_ZONE), changed: true }
      : { value: '', changed: false }
  }

  // 已经是「完整格式 + 显式时区」就是合规，一个字都不改
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/.test(literal)) {
    return { value: literal, changed: false }
  }

  if (!parsed) return { value: literal, changed: false }

  /*
   * 裸日期 `2026-10-24` 的语义是「当天 00:00（站点时区）」。
   * 不能直接 `new Date('2026-10-24')` —— 那会按 **UTC** 解析，
   * 得到前一天 16:00（站点时区），日期整体前移一天。
   * 这里显式拼上站点时区的偏移再解析。
   */
  if (/^\d{4}-\d{2}-\d{2}$/.test(literal)) {
    const midnight = new Date(`${literal}T00:00:00${offsetOf(literal, SITE_TIME_ZONE)}`)
    if (!Number.isNaN(midnight.getTime())) {
      return { value: formatZonedIso(midnight, SITE_TIME_ZONE), changed: true }
    }
  }

  // 其余情况（如只写了 `2026-10-19 04:09`）：按解析出的时刻补齐时区
  const normalized = formatZonedIso(parsed, SITE_TIME_ZONE)
  return { value: normalized, changed: normalized !== literal }
}

/** 取某天正午在站点时区的偏移（避开夏令时切换的边界）。 */
function offsetOf(dateText: string, timeZone: string): string {
  const noon = new Date(`${dateText}T12:00:00Z`)
  const label = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(noon)
    .find((part) => part.type === 'timeZoneName')?.value
  return /GMT([+-]\d{2}:\d{2})/.exec(label ?? '')?.[1] ?? '+00:00'
}

/** 规范化标签数组。 */
function normalizeTags(post: PostFile): { value: unknown; changed: boolean } {
  const raw = post.data.tags
  if (raw === undefined) return { value: undefined, changed: false }
  if (!Array.isArray(raw)) return { value: raw, changed: false }

  const seen = new Set<string>()
  const cleaned: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const tag = item.trim()
    if (tag === '' || seen.has(tag)) continue
    seen.add(tag)
    cleaned.push(tag)
  }

  const changed = cleaned.length !== raw.length
  return { value: cleaned, changed }
}

/** 计算单个文件的修复。 */
function planFix(post: PostFile): FixResult | null {
  const changes: string[] = []
  const next: Record<string, unknown> = { ...post.data }

  // ---------- 日期 ----------
  const dateFix = normalizeDate(post)
  if (dateFix.changed) {
    changes.push(`date: ${rawScalarValue(post.raw, 'date') ?? '(缺失)'} → ${dateFix.value}`)
  }
  /*
   * **无条件把规范化后的字符串写回**，即使 `changed` 为 false。
   *
   * 原因：`next` 是从 `post.data` 浅拷贝来的，而 `gray-matter` 已经把 `date`
   * 解析成了 `Date` 对象。如果不覆盖，序列化时就会拿到对象——
   * 早期版本正是这样把一个正常的 frontmatter 写成了
   * `date: Mon Oct 19 2026 04:09:28 GMT+0800 (China Standard Time)`。
   * 必须让落盘的永远是「文件里的原始字面量」（已合规时它就是原文）。
   */
  if (dateFix.value !== '') {
    next.date = dateFix.value
  }

  // ---------- 标签 ----------
  const tagFix = normalizeTags(post)
  if (tagFix.changed) {
    changes.push(`tags: 规范化（去空/去重/去空白）→ [${(tagFix.value as string[]).join(', ')}]`)
    next.tags = tagFix.value
  }

  // ---------- 补齐可选字段 ----------
  if (next.tags === undefined) {
    changes.push('补齐 tags: []')
    next.tags = []
  }
  if (next.description === undefined) {
    // 留空而不是编造摘要：构建期会自动取正文第一段，那是更好的兜底
    changes.push("补齐 description: ''")
    next.description = ''
  }
  if (next.draft === undefined) {
    changes.push('补齐 draft: false')
    next.draft = false
  }
  if (next.outline === undefined) {
    changes.push('补齐 outline: true')
    next.outline = true
  }

  // ---------- 字段顺序 ----------
  const beforeOrder = Object.keys(next).join(',')
  const reordered = reorderKeys(next)
  if (Object.keys(reordered).join(',') !== beforeOrder) {
    changes.push('重排 frontmatter 字段顺序')
  }

  if (changes.length === 0) return null

  const content = stringifyFrontmatter(reordered, post.body)
  return { file: post.path.filePath, changes, content }
}

/**
 * 按规范顺序重排键。
 *
 * 只调整已知字段的相对位置，未知/废弃字段保持在原来的「相对位置」上被推到末尾，
 * 避免因为重排把它们插到奇怪的地方。
 */
function reorderKeys(data: Record<string, unknown>): Record<string, unknown> {
  const canonical = ['title', 'date', 'tags', 'description', 'draft', 'outline']
  const result: Record<string, unknown> = {}

  for (const key of canonical) {
    if (data[key] !== undefined) result[key] = data[key]
  }
  for (const [key, value] of Object.entries(data)) {
    if (canonical.includes(key)) continue
    result[key] = value
  }

  return result
}

/** 主流程。 */
export default function main(argv: string[]): void {
  const args = parseArgs(argv, [...SPECS])
  if (wantsHelp(args)) {
    printHelp()
    return
  }

  const localeOption = optionValue(args, 'lang')
  const locale = localeOption === undefined ? undefined : parseLocale(localeOption)
  const dryRun = hasOption(args, 'dry-run')

  const posts = collectPostFiles(locale)
  const results: FixResult[] = []

  for (const post of posts) {
    const plan = planFix(post)
    if (plan) results.push(plan)
  }

  blank()

  if (results.length === 0) {
    success(`无需修复：${posts.length} 篇文章都已合规`)
    blank()
    return
  }

  let written = 0
  for (const result of results) {
    console.log(c.bold(result.file))
    for (const change of result.changes) info(`  ${c.dim('·')} ${change}`)

    if (!dryRun) {
      const absolute = posts.find((post) => post.path.filePath === result.file)?.path.absolutePath
      if (absolute) {
        writeFileSync(absolute, result.content, 'utf-8')
        written += 1
      }
    }
    blank()
  }

  if (dryRun) {
    warn(`dry-run：${results.length} 个文件需要修复，未写盘`)
  } else {
    success(`已修复 ${written} 个文件`)
    info(c.dim('建议接着运行 pnpm check 确认'))
  }
  blank()
}
