/**
 * `pnpm doc list` —— 列出 / 筛选文章，或切换成标签、统计视图。
 *
 * 三种视图共用同一套全局过滤（`-l/-d/-t`）：
 * - 默认：按日期分组的文章表格；
 * - `-t`（裸用）：标签汇总视图；
 * - `--stats`：内容统计视图。
 */

import { countWords } from '../../.vitepress/support/format'
import type { LocaleCode } from '../../.vitepress/types'
import { hasOption, optionValue, type OptionSpec } from '../lib/args'
import {
  parseCommandArgs,
  parseScope,
  printCommandHelp,
  wantsCommandHelp,
  type CommandMeta,
} from '../lib/cli'
import { isoDateInZone } from '../lib/dates'
import {
  matchesScope,
  parseDateFilter,
  parseTagList,
  scopeSummary,
  type Scope,
} from '../lib/filters'
import { collectPostFiles, postDate, type PostFile } from '../lib/posts'
import { askConfirm, askSelect, askText } from '../lib/prompt'
import { LOCALE_CODES, SITE_TIME_ZONE } from '../lib/site'
import {
  blank,
  c,
  displayWidth,
  formatTable,
  heading,
  info,
  table,
  truncateByWidth,
} from '../lib/ui'

/** 命令选项。 */
const SPECS: readonly OptionSpec[] = [
  { name: 'stats', boolean: true },
  { name: 'compact', boolean: true },
  { name: 'drafts', boolean: true },
  { name: 'sort' },
  { name: 'limit' },
]

/** 帮助信息。 */
export const meta: CommandMeta = {
  name: 'list',
  summary: '列出文章；-t 看标签视图，--stats 看统计',
  usage: 'list [参数]',
  options: [
    { flag: '-t, --tag', description: '不带值：标签汇总视图；带值：按标签过滤' },
    { flag: '--stats', description: '内容统计视图' },
    { flag: '--drafts', description: '把草稿也列出来（默认隐藏）' },
    { flag: '--compact', description: '紧凑模式：每行一篇，不分组' },
    { flag: '--sort <field>', description: '排序：date（默认）/ title / words' },
    { flag: '--limit <n>', description: '最多显示 N 篇' },
  ],
  examples: [
    'pnpm doc list',
    'pnpm doc list -d=2026 -t=随笔',
    'pnpm doc list -d=2026110101',
    'pnpm doc list -t',
    'pnpm doc list --stats',
  ],
}

/** 展示用的文章行。 */
interface Row {
  post: PostFile
  title: string
  date: string
  time: number
  tags: string[]
  draft: boolean
  words: number
}

/** 排序字段。 */
type SortField = 'date' | 'title' | 'words'

/** 列表视图的选项。 */
interface ListOptions {
  drafts: boolean
  compact: boolean
  sort: SortField
  limit: number | undefined
}

/** 取过滤后的文章（不分草稿）。 */
function scopedPosts(scope: Scope): PostFile[] {
  return collectPostFiles().filter((post) => matchesScope(post, scope))
}

/** 从 frontmatter 取标题。 */
function titleOf(post: PostFile): string {
  const value = post.data.title
  return typeof value === 'string' && value.trim() ? value.trim() : '（无标题）'
}

/** 从 frontmatter 取标签。 */
function tagsOf(post: PostFile): string[] {
  const value = post.data.tags
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

/** 转成展示行。 */
function toRow(post: PostFile): Row {
  const date = postDate(post)
  return {
    post,
    title: titleOf(post),
    date: date ? isoDateInZone(date, SITE_TIME_ZONE) : '（无日期）',
    time: date ? date.getTime() : 0,
    tags: tagsOf(post),
    draft: post.data.draft === true,
    words: countWords(post.body),
  }
}

/** 排序：新的在前；同日按当日序号；标题/字数排序为附加选项。 */
function sortRows(rows: Row[], field: SortField): Row[] {
  return rows.toSorted((a, b) => {
    if (field === 'title') return a.title.localeCompare(b.title)
    if (field === 'words') return b.words - a.words

    if (a.time !== b.time) return b.time - a.time
    const seqA = a.post.path.sequence || '99'
    const seqB = b.post.path.sequence || '99'
    if (seqA !== seqB) return seqA.localeCompare(seqB)
    return a.title.localeCompare(b.title)
  })
}

/** 默认文章列表视图。 */
function printList(scope: Scope, options: ListOptions): void {
  let rows = scopedPosts(scope).map(toRow)
  if (!options.drafts) rows = rows.filter((row) => !row.draft)
  rows = sortRows(rows, options.sort)
  if (options.limit !== undefined) rows = rows.slice(0, options.limit)

  blank()
  if (rows.length === 0) {
    info(`${c.yellow('!')} 没有找到文章（${scopeSummary(scope)}）`)
    if (!options.drafts) info(c.dim('   （草稿默认隐藏；加 --drafts 可显示）'))
    blank()
    return
  }

  const totalWords = rows.reduce((sum, row) => sum + row.words, 0)
  heading(scopeSummary(scope), `${rows.length} 篇 / ${totalWords} 字`)
  blank()

  if (options.compact) {
    printCompact(rows)
  } else {
    printGrouped(rows)
  }
  blank()
}

/** 紧凑模式：每行一篇。 */
function printCompact(rows: Row[]): void {
  for (const row of rows) {
    const flag = row.draft ? c.dim(' [草稿]') : ''
    const tags = row.tags.length > 0 ? c.dim(` #${row.tags.join(' #')}`) : ''
    info(
      `${c.dim(row.date)}  ${c.dim(row.post.path.daySeq)}  ${c.dim(row.post.path.locale.padEnd(6))} ${row.title}${tags}${flag}`,
    )
  }
}

/** 分组模式：按日期分组，表格展示。 */
function printGrouped(rows: Row[]): void {
  const groups = new Map<string, Row[]>()
  for (const row of rows) {
    const list = groups.get(row.date)
    if (list) list.push(row)
    else groups.set(row.date, [row])
  }

  let first = true
  for (const [date, groupRows] of groups) {
    if (!first) blank()
    first = false

    const words = groupRows.reduce((sum, row) => sum + row.words, 0)
    console.log(`${c.bold(c.cyan(date))} ${c.dim(`· ${groupRows.length} 篇 · ${words} 字`)}`)
    printTable(groupRows, true)
  }
}

/** 打印文章表格。 */
function printTable(rows: Row[], indented = false): void {
  const indent = indented ? '  ' : ''
  const titleWidth = Math.min(
    Math.max(...rows.map((row) => displayWidth(row.title)), 12),
    Math.max(20, (process.stdout.columns ?? 100) - 46),
  )

  const tableRows: string[][] = [
    ['日序号', '标题', '标签', '字数', '语言'],
    ...rows.map((row) => [
      row.post.path.daySeq || c.dim('--'),
      `${truncateByWidth(row.title, titleWidth)}${row.draft ? c.dim(' [草稿]') : ''}`,
      row.tags.length > 0 ? row.tags.join('、') : c.dim('—'),
      String(row.words),
      row.post.path.locale,
    ]),
  ]

  table(tableRows, indent)
}

/** 标签视图。 */
function printTags(scope: Scope, includeDrafts: boolean): void {
  const posts = scopedPosts(scope).filter((post) => includeDrafts || post.data.draft !== true)
  const locales = scope.locales ?? LOCALE_CODES

  blank()

  for (const locale of locales) {
    const index = new Map<
      string,
      { tag: string; count: number; posts: { title: string; date: string }[] }
    >()

    for (const post of posts) {
      if (post.path.locale !== locale) continue
      const date = postDate(post)
      const day = date ? isoDateInZone(date, SITE_TIME_ZONE) : ''
      for (const tag of tagsOf(post)) {
        const trimmed = tag.trim()
        if (trimmed === '') continue
        const existing = index.get(trimmed)
        if (existing) {
          existing.count += 1
          existing.posts.push({ title: titleOf(post), date: day })
        } else {
          index.set(trimmed, {
            tag: trimmed,
            count: 1,
            posts: [{ title: titleOf(post), date: day }],
          })
        }
      }
    }

    const stats = [...index.values()].toSorted(
      (a, b) => b.count - a.count || a.tag.localeCompare(b.tag),
    )
    const totalPosts = stats.reduce((sum, stat) => sum + stat.count, 0)

    console.log(`${c.bold(locale)} ${c.dim(`· ${stats.length} 个标签 · ${totalPosts} 次引用`)}`)
    if (stats.length === 0) {
      info(`  ${c.dim('（没有标签）')}`)
      blank()
      continue
    }

    blank()
    const rows = formatTable(
      [
        ['标签', '文章数', '文章'],
        ...stats.map((stat) => [
          stat.tag,
          String(stat.count),
          stat.posts
            .toSorted((a, b) => b.date.localeCompare(a.date))
            .map((post) => post.title)
            .slice(0, 3)
            .join('、') + (stat.posts.length > 3 ? c.dim(` 等 ${stat.posts.length} 篇`) : ''),
        ]),
      ],
      { headerRule: true },
    )
    for (const line of rows) info(`  ${line}`)
    blank()

    // 大小写/空白不一致的标签会生成不同标签页，构建期不报错，只能在这里提示
    const synonyms = findSynonyms(stats)
    if (synonyms.length > 0) {
      info(`  ${c.yellow('!')} 大小写/空白不一致的标签（会生成不同标签页）`)
      for (const variants of synonyms) info(`    ${variants.join('  /  ')}`)
      blank()
    }
  }
}

/** 找出仅大小写/空白不同的同义标签。 */
function findSynonyms(stats: { tag: string }[]): string[][] {
  const groups = new Map<string, string[]>()
  for (const stat of stats) {
    const key = stat.tag.toLowerCase().replace(/\s+/g, '')
    const list = groups.get(key)
    if (list) list.push(stat.tag)
    else groups.set(key, [stat.tag])
  }
  return [...groups.values()]
    .filter((variants) => variants.length > 1)
    .map((variants) => variants.toSorted())
}

/** 统计视图。 */
function printStats(scope: Scope): void {
  const posts = scopedPosts(scope)
  const locales = scope.locales ?? LOCALE_CODES
  const articleDirs = new Set(posts.map((post) => post.path.articleDir))

  blank()
  if (posts.length === 0) {
    info(`${c.yellow('!')} 没有找到文章（${scopeSummary(scope)}）`)
    blank()
    return
  }

  const totalWords = posts.reduce((sum, post) => sum + countWords(post.body), 0)
  console.log(
    `${c.bold('内容统计')} ${c.dim(`· ${articleDirs.size} 个文章目录 · ${posts.length} 篇（语言版本） · ${totalWords.toLocaleString('zh-CN')} 字`)}`,
  )
  blank()

  const rows: string[][] = [['语言', '文章', '草稿', '字数', '标签', '时间跨度']]
  for (const locale of locales) {
    const localePosts = posts.filter((post) => post.path.locale === locale)
    if (localePosts.length === 0) continue

    let words = 0
    let drafts = 0
    const tags = new Set<string>()
    let firstDate = ''
    let lastDate = ''

    for (const post of localePosts) {
      words += countWords(post.body)
      if (post.data.draft === true) drafts += 1
      for (const tag of tagsOf(post)) if (tag.trim()) tags.add(tag.trim())

      const date = postDate(post)
      if (date) {
        const day = isoDateInZone(date, SITE_TIME_ZONE)
        if (!firstDate || day < firstDate) firstDate = day
        if (!lastDate || day > lastDate) lastDate = day
      }
    }

    rows.push([
      locale,
      String(localePosts.length),
      drafts > 0 ? String(drafts) : c.dim('0'),
      words.toLocaleString('zh-CN'),
      String(tags.size),
      firstDate ? `${firstDate} → ${lastDate}` : c.dim('（无）'),
    ])
  }

  for (const line of formatTable(rows, { headerRule: true })) info(`  ${line}`)
  blank()
}

/** 校验排序字段。 */
function parseSort(value: string | undefined): SortField {
  if (value === undefined) return 'date'
  if (value === 'date' || value === 'title' || value === 'words') return value
  throw new Error(`--sort 只支持 date / title / words，收到：${value}`)
}

/** 校验条数。 */
function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!/^\d+$/.test(value) || Number(value) <= 0) {
    throw new Error(`--limit 需要正整数，收到：${value}`)
  }
  return Number(value)
}

/** 命令入口。 */
export default async function main(argv: string[]): Promise<void> {
  const args = parseCommandArgs(argv, SPECS)
  if (wantsCommandHelp(args)) {
    printCommandHelp(meta)
    return
  }

  const scope = parseScope(args)
  const options: ListOptions = {
    drafts: hasOption(args, 'drafts'),
    compact: hasOption(args, 'compact'),
    sort: parseSort(optionValue(args, 'sort')),
    limit: parseLimit(optionValue(args, 'limit')),
  }

  if (scope.tag.mode === 'bare') {
    printTags(scope, options.drafts)
    return
  }
  if (hasOption(args, 'stats')) {
    printStats(scope)
    return
  }
  printList(scope, options)
}

/** 供主菜单复用：先问筛选条件，再输出。 */
export async function wizard(): Promise<void> {
  const view = await askSelect<'list' | 'tags' | 'stats'>(
    '看什么？',
    [
      { value: 'list', label: '文章列表' },
      { value: 'tags', label: '标签汇总' },
      { value: 'stats', label: '内容统计' },
    ],
    'list',
  )

  const localeChoice = await askSelect<'all' | LocaleCode>(
    '语言',
    [
      { value: 'all', label: '全部语言' },
      { value: 'zh-cn', label: '简体中文' },
      { value: 'en', label: 'English' },
    ],
    'all',
  )
  const localeScope = localeChoice === 'all' ? undefined : [localeChoice]

  const dateText = await askText('日期（2026 / 20261101 / 202601..202606，留空=全部）')
  const date = parseDateFilter(dateText === '' ? undefined : dateText)

  const tagText = view === 'tags' ? '' : await askText('标签（逗号分隔，留空=全部）')
  const tag =
    tagText === ''
      ? { mode: 'none' as const }
      : { mode: 'some' as const, tags: parseTagList(tagText) }

  const drafts = await askConfirm('包含草稿？', false)

  const scope: Scope = { locales: localeScope, date, tag }
  const options: ListOptions = { drafts, compact: false, sort: 'date', limit: undefined }

  if (view === 'tags') printTags(scope, drafts)
  else if (view === 'stats') printStats(scope)
  else printList(scope, options)
}
