/**
 * `pnpm posts [YYYYMMDD]` —— 友好格式列出文章。
 *
 * 为什么不叫 `pnpm list`：`list` 是 pnpm 的内置命令，pnpm 会在执行脚本之前
 * 先解析参数并直接报错（实测 `pnpm list 20261024 -l=zh-cn` →
 * `error: unexpected argument '-l' found`），脚本根本不会启动。
 * 因此对外统一用 `posts`，`list` 只留在 `pnpm run list` 这一条路径上。
 *
 * 数据来源是**磁盘上的真实文件**而不是构建期缓存：
 * 命令行要能看到「刚建好、还没写 date」的文章，也要能在不启动 VitePress 的
 * 情况下工作。因此这里自己读文件，但「算不算文章」的判定与
 * `.vitepress/support/content.ts` 的 `isPost()` 保持一致（posts 分区 + 有 date）。
 */

import { countWords } from '../.vitepress/support/format'
import { hasOption, optionValue, parseArgs, wantsHelp } from './lib/args'
import { formatReadableDate, isoDateInZone, parseCompactDate } from './lib/dates'
import { collectPostFiles, postDate } from './lib/posts'
import type { PostFile } from './lib/posts'
import { parseLocale, SITE_TIME_ZONE } from './lib/site'
import { blank, c, displayWidth, heading, helpLines, info, table, truncateByWidth } from './lib/ui'

/** 选项定义。 */
const SPECS = [
  { name: 'lang', short: 'l' },
  { name: 'tags', short: 't' },
  { name: 'draft', boolean: true },
  { name: 'json', boolean: true },
  { name: 'compact', boolean: true },
  { name: 'help', short: 'h', boolean: true },
] as const

/** 帮助。 */
function printHelp(): void {
  helpLines(
    'pnpm posts',
    'pnpm posts [YYYYMMDD] [选项]',
    [
      { flag: '-l, --lang <code>', description: '只看某种语言：zh-cn 或 en（默认两种都看）' },
      { flag: '-t, --tags <a,b>', description: '只看含这些标签的文章（逗号分隔，任一命中）' },
      { flag: '--draft', description: '把草稿也列出来（默认隐藏，与站点行为一致）' },
      { flag: '--compact', description: '紧凑模式：每行一篇，不分组' },
      { flag: '--json', description: '输出 JSON，便于脚本处理' },
      { flag: '-h, --help', description: '显示本帮助' },
    ],
    [
      'pnpm posts',
      'pnpm posts 20261024',
      'pnpm posts 20261024 -l=zh-cn',
      'pnpm posts --tags=随笔 --compact',
    ],
  )
}

/** 展示用的文章行。 */
interface Row {
  post: PostFile
  title: string
  /** 展示用的日期 `YYYY-MM-DD`（站点时区）。 */
  date: string
  /** 完整时刻（毫秒），仅用于排序。 */
  time: number
  tags: string[]
  draft: boolean
  words: number
}

/** 排序所需的字段（抽出来便于单测，不必构造整个 Row）。 */
export interface SortableRow {
  title: string
  time: number
  sequence: string
}

/**
 * 文章排序：新的在前。
 *
 * 按**完整时刻**排序而不是按 `YYYY-MM-DD` 字符串。早期用日期字符串比较，
 * 同一天的文章全部相等，于是退回按标题排序——实测同一天建的三篇会显示成
 * `01 未命名文章 / 03 第三篇 / 02 第二篇`，序号完全乱掉。
 *
 * 顺序：时刻倒序 → 当日序号正序 → 标题。这样同一天的多篇永远按写作顺序排列。
 */
export function compareRows(a: SortableRow, b: SortableRow): number {
  if (a.time !== b.time) return b.time - a.time
  const seqA = a.sequence || '99'
  const seqB = b.sequence || '99'
  if (seqA !== seqB) return seqA.localeCompare(seqB)
  return a.title.localeCompare(b.title)
}

/** Row → 排序字段。 */
function toSortable(row: Row): SortableRow {
  return { title: row.title, time: row.time, sequence: row.post.path.sequence }
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
    // 必须按站点时区取日期：直接截 ISO 串得到的是 UTC 日期，会差一天
    date: date ? isoDateInZone(date, SITE_TIME_ZONE) : '（无日期）',
    time: date ? date.getTime() : 0,
    tags: tagsOf(post),
    draft: post.data.draft === true,
    words: countWords(post.body),
  }
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

  // 位置参数：可选的 YYYYMMDD
  const dateArg = args.positionals[0]
  const dateFilter = dateArg === undefined ? null : parseCompactDate(dateArg)

  // 只关心 posts 分区里「有 date」的，与内容管线的口径一致
  const includeDrafts = hasOption(args, 'draft')
  const tagFilter = optionValue(args, 'tags')
    ?.split(/[,，]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)

  let rows = collectPostFiles(locale)
    .map(toRow)
    .filter((row) => includeDrafts || !row.draft)
    .filter((row) => {
      if (!dateFilter) return true
      // 按「目录日期」还是「frontmatter 日期」过滤？
      // 用户输入 20261024 想找的是这一天的文章，因此以 frontmatter 的 date 为准
      // （目录只是给人看的，WRITING.md 明确写了这一点）。
      return row.date === formatReadableDate(dateFilter)
    })
    .filter((row) => {
      if (!tagFilter || tagFilter.length === 0) return true
      return row.tags.some((tag) => tagFilter.includes(tag))
    })

  /*
   * 新的在前，按**完整时刻**排序而不是按 `YYYY-MM-DD` 字符串。
   *
   * 早期用日期字符串比较，同一天的文章全部相等，于是退回按标题排序——
   * 实测同一天建的三篇会显示成 `01 未命名文章 / 03 第三篇 / 02 第二篇`，
   * 序号完全乱掉。先比时刻，时刻相同再比「当日序号」，
   * 这样同一天的多篇永远按写作顺序排列。
   */
  rows = rows.toSorted((a, b) => compareRows(toSortable(a), toSortable(b)))

  if (hasOption(args, 'json')) {
    console.log(
      JSON.stringify(
        rows.map((row) => ({
          title: row.title,
          date: row.date,
          locale: row.post.path.locale,
          tags: row.tags,
          draft: row.draft,
          words: row.words,
          url: row.post.path.url,
          file: row.post.path.filePath,
          sequence: row.post.path.sequence,
          slug: row.post.path.slug,
        })),
        null,
        2,
      ),
    )
    return
  }

  if (rows.length === 0) {
    blank()
    const scope = dateFilter ? `${formatReadableDate(dateFilter)} ` : ''
    const lang = locale ? `${locale} ` : ''
    info(`${c.yellow('!')} 没有找到${scope}${lang}文章`)
    if (!includeDrafts) info(c.dim('   （草稿默认隐藏；加 --draft 可显示）'))
    blank()
    return
  }

  const totalWords = rows.reduce((sum, row) => sum + row.words, 0)

  blank()
  const scopeParts: string[] = []
  if (dateFilter) scopeParts.push(formatReadableDate(dateFilter))
  scopeParts.push(locale ? locale : '全部语言')
  if (tagFilter && tagFilter.length > 0) scopeParts.push(`标签 ${tagFilter.join('、')}`)
  heading(scopeParts.join(' · '), `${rows.length} 篇 / ${totalWords} 字`)
  blank()

  if (hasOption(args, 'compact')) {
    printCompact(rows)
  } else {
    printGrouped(rows, Boolean(dateFilter))
  }
  blank()
}

/** 紧凑模式：每行一篇。 */
function printCompact(rows: Row[]): void {
  for (const row of rows) {
    const flag = row.draft ? c.dim(' [草稿]') : ''
    const tags = row.tags.length > 0 ? c.dim(` #${row.tags.join(' #')}`) : ''
    info(`${c.dim(row.date)}  ${c.dim(row.post.path.locale.padEnd(6))} ${row.title}${tags}${flag}`)
  }
}

/** 分组模式：按日期分组，表格展示。 */
function printGrouped(rows: Row[], singleDay: boolean): void {
  // 单日查询时不必再按日期分组，直接一张表
  if (singleDay) {
    printTable(rows)
    return
  }

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
    ['序号', '标题', '标签', '字数', '语言'],
    ...rows.map((row) => [
      row.post.path.sequence || c.dim('--'),
      `${truncateByWidth(row.title, titleWidth)}${row.draft ? c.dim(' [草稿]') : ''}`,
      row.tags.length > 0 ? row.tags.join('、') : c.dim('—'),
      String(row.words),
      row.post.path.locale,
    ]),
  ]

  table(tableRows, indent)
}
