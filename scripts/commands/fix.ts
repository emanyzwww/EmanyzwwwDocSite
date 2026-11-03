/**
 * `pnpm doc fix` —— 自动修复元字段里能安全自动处理的问题。
 *
 * 安全边界（宁可少修，不可改错）：
 * - ✅ 重排 frontmatter 字段顺序
 * - ✅ 补齐缺失的可选字段（slug / tags / description / draft / outline）
 * - ✅ 把裸日期补成带时区的完整格式
 * - ✅ 规范化标签（去空白、去空项、去重，保持原顺序）
 * - ✅ 给 title / slug / description 补上单引号
 * - ❌ 不改标题、正文、已有 slug，不移动目录，不删废弃字段
 *
 * 默认写盘；`--try` 只打印将改什么。TTY 裸调进入勾选向导。
 */

import { writeFileSync } from 'node:fs'

import { isUsableSlug, slugify } from '../../.vitepress/support/slug'
import { hasOption } from '../lib/args'
import {
  parseCommandArgs,
  parseScope,
  printCommandHelp,
  shouldWizard,
  tagFilterOf,
  wantsCommandHelp,
  type CommandMeta,
} from '../lib/cli'
import { formatZonedIso } from '../lib/dates'
import { matchesScope, scopeSummary, type Scope } from '../lib/filters'
import { rawScalarValue, stringifyFrontmatter, unquotedStringFields } from '../lib/frontmatter'
import { FRONTMATTER_KEYS } from '../lib/frontmatter-schema'
import { collectPostFiles, postDate, type PostFile } from '../lib/posts'
import { askConfirm, askMultiSelect } from '../lib/prompt'
import { SITE_TIME_ZONE } from '../lib/site'
import { blank, c, info, success, warn } from '../lib/ui'

/** 帮助信息。 */
export const meta: CommandMeta = {
  name: 'fix',
  summary: '自动修复可安全处理的元字段',
  usage: 'fix [参数]',
  options: [{ flag: '--try', description: '只显示会改什么，不写盘' }],
  examples: ['pnpm doc fix --try', 'pnpm doc fix -l=zh-cn,en', 'pnpm doc fix -d=2026'],
}

/** 一次修复的结果。 */
interface FixResult {
  file: string
  absolutePath: string
  changes: string[]
  content: string
}

/**
 * 把 `date` 规范成带时区的完整格式。
 *
 * 必须基于文件里的原始字面量判断：`gray-matter` 解析后是 `Date` 对象，
 * `2026-10-19T04:09:28+08:00` 与 `2026-10-19` 在解析后长得一模一样。
 */
function normalizeDate(post: PostFile): { value: string; changed: boolean } {
  const literal = rawScalarValue(post.raw, 'date')
  const parsed = postDate(post)

  if (literal === undefined || literal === '') {
    return parsed
      ? { value: formatZonedIso(parsed, SITE_TIME_ZONE), changed: true }
      : { value: '', changed: false }
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/.test(literal)) {
    return { value: literal, changed: false }
  }

  if (!parsed) return { value: literal, changed: false }

  if (/^\d{4}-\d{2}-\d{2}$/.test(literal)) {
    const midnight = new Date(`${literal}T00:00:00${offsetOf(literal, SITE_TIME_ZONE)}`)
    if (!Number.isNaN(midnight.getTime())) {
      return { value: formatZonedIso(midnight, SITE_TIME_ZONE), changed: true }
    }
  }

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

  return { value: cleaned, changed: cleaned.length !== raw.length }
}

/** 按规范顺序重排键；未知字段保持原相对顺序、追加在末尾。 */
function reorderKeys(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const key of FRONTMATTER_KEYS) {
    if (data[key] !== undefined) result[key] = data[key]
  }
  for (const [key, value] of Object.entries(data)) {
    if ((FRONTMATTER_KEYS as readonly string[]).includes(key)) continue
    result[key] = value
  }
  return result
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
  // 无条件写回字符串：gray-matter 已把 date 解析成 Date，不覆盖会序列化坏
  if (dateFix.value !== '') next.date = dateFix.value

  // ---------- 标签 ----------
  const tagFix = normalizeTags(post)
  if (tagFix.changed) {
    changes.push(`tags: 规范化（去空/去重/去空白）→ [${(tagFix.value as string[]).join(', ')}]`)
    next.tags = tagFix.value
  }

  // ---------- 补齐可选字段 ----------
  if (next.slug === undefined || next.slug === '') {
    const derived = slugify(typeof next.title === 'string' ? next.title : '')
    const slug = isUsableSlug(derived) ? derived : 'untitled'
    changes.push(`补齐 slug: ${slug}（由 title 推导）`)
    next.slug = slug
  }
  if (next.tags === undefined) {
    changes.push('补齐 tags: []')
    next.tags = []
  }
  if (next.description === undefined) {
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

  // ---------- 字符串引号 ----------
  const unquoted = unquotedStringFields(post.raw)
  if (unquoted.length > 0) {
    changes.push(`字符串加引号：${unquoted.join('、')}`)
  }

  // ---------- 字段顺序 ----------
  const beforeOrder = Object.keys(next).join(',')
  const reordered = reorderKeys(next)
  if (Object.keys(reordered).join(',') !== beforeOrder) {
    changes.push('重排 frontmatter 字段顺序')
  }

  if (changes.length === 0) return null

  return {
    file: post.path.filePath,
    absolutePath: post.path.absolutePath,
    changes,
    content: stringifyFrontmatter(reordered, post.body),
  }
}

/** 收集范围内的修复计划。 */
function collectPlans(scope: Scope): FixResult[] {
  const posts = collectPostFiles().filter((post) => matchesScope(post, scope))
  return posts.map(planFix).filter((plan): plan is FixResult => plan !== null)
}

/** 应用修复并打印。 */
function applyPlans(plans: FixResult[]): void {
  blank()
  for (const plan of plans) {
    console.log(c.bold(plan.file))
    for (const change of plan.changes) info(`  ${c.dim('·')} ${change}`)
    writeFileSync(plan.absolutePath, plan.content, 'utf-8')
    blank()
  }
  success(`已修复 ${plans.length} 个文件`)
  info(c.dim('建议接着运行 pnpm doc check 确认'))
  blank()
}

/** 命令入口。 */
export default async function main(argv: string[]): Promise<void> {
  const args = parseCommandArgs(argv, [{ name: 'try', boolean: true }])
  if (wantsCommandHelp(args)) {
    printCommandHelp(meta)
    return
  }

  const scope = parseScope(args)
  tagFilterOf(scope, 'fix')
  const plans = collectPlans(scope)
  const tryRun = hasOption(args, 'try')

  blank()
  if (plans.length === 0) {
    success('无需修复：范围内的文章都已合规')
    blank()
    return
  }

  if (tryRun) {
    warn(`--try：${plans.length} 个文件需要修复，未写盘`)
    blank()
    for (const plan of plans) {
      console.log(c.bold(plan.file))
      for (const change of plan.changes) info(`  ${c.dim('·')} ${change}`)
      blank()
    }
    return
  }

  if (shouldWizard(argv)) {
    await runWizard(scope, plans)
    return
  }

  info(c.dim(`范围：${scopeSummary(scope)}`))
  applyPlans(plans)
}

/** 勾选要修复的文件，确认后写盘。 */
async function runWizard(scope: Scope, plans: FixResult[]): Promise<void> {
  info(c.dim(`范围：${scopeSummary(scope)}，${plans.length} 个文件可修`))
  blank()

  const selected = await askMultiSelect(
    '选择要修复的文件（空格勾选，回车确认）',
    plans.map((plan) => ({
      value: plan.file,
      label: `${plan.file} ${c.dim(`（${plan.changes.length} 项）`)}`,
    })),
    plans.map((plan) => plan.file),
  )

  const chosen = plans.filter((plan) => selected.includes(plan.file))
  if (chosen.length === 0) {
    warn('没有选择任何文件')
    return
  }

  const confirmed = await askConfirm(`确认修复这 ${chosen.length} 个文件？`, true)
  if (!confirmed) {
    warn('已取消')
    return
  }

  applyPlans(chosen)
}

/** 供主菜单复用。 */
export async function wizard(): Promise<void> {
  const scope: Scope = { locales: undefined, date: undefined, tag: { mode: 'none' } }
  const plans = collectPlans(scope)
  blank()
  if (plans.length === 0) {
    success('无需修复：所有文章都已合规')
    blank()
    return
  }
  await runWizard(scope, plans)
}
