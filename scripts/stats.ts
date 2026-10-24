/**
 * `pnpm stats` —— 站点内容统计。
 *
 * 回答「我写了多少」这类问题：文章数、总字数、按月/年分布、最长最短的文章。
 * 与 `pnpm posts` 的区别是它面向**汇总**而不是清单。
 */

import { countWords } from '../.vitepress/support/format'
import type { LocaleCode } from '../.vitepress/types'
import { hasOption, optionValue, parseArgs, wantsHelp } from './lib/args'
import { isoDateInZone } from './lib/dates'
import { collectPostFiles, postDate } from './lib/posts'
import { parseLocale, LOCALE_CODES, LOCALES, SITE_TIME_ZONE } from './lib/site'
import { blank, c, formatTable, helpLines, info, padEnd } from './lib/ui'

/** 选项定义。 */
const SPECS = [
  { name: 'lang', short: 'l' },
  { name: 'json', boolean: true },
  { name: 'help', short: 'h', boolean: true },
] as const

/** 帮助。 */
function printHelp(): void {
  helpLines(
    'pnpm stats',
    'pnpm stats [选项]',
    [
      { flag: '-l, --lang <code>', description: '只统计某种语言（默认逐语言分开统计）' },
      { flag: '--json', description: '输出 JSON' },
      { flag: '-h, --help', description: '显示本帮助' },
    ],
    ['pnpm stats', 'pnpm stats -l=zh-cn'],
  )
}

/** 一种语言的统计结果。 */
interface LocaleStats {
  locale: LocaleCode
  label: string
  posts: number
  drafts: number
  words: number
  tags: number
  firstDate: string
  lastDate: string
  byYear: Map<string, number>
  byMonth: Map<string, number>
  longest: { title: string; words: number } | null
  shortest: { title: string; words: number } | null
}

/** 统计一种语言。 */
function statsOf(locale: LocaleCode): LocaleStats {
  const posts = collectPostFiles(locale)

  let words = 0
  let drafts = 0
  const tags = new Set<string>()
  const byYear = new Map<string, number>()
  const byMonth = new Map<string, number>()
  let firstDate = ''
  let lastDate = ''
  let longest: { title: string; words: number } | null = null
  let shortest: { title: string; words: number } | null = null

  for (const post of posts) {
    const wordCount = countWords(post.body)
    words += wordCount
    if (post.data.draft === true) drafts += 1

    const postTags = Array.isArray(post.data.tags) ? post.data.tags : []
    for (const tag of postTags) {
      if (typeof tag === 'string' && tag.trim()) tags.add(tag.trim())
    }

    const date = postDate(post)
    if (date) {
      // 按站点时区取日期：UTC 会让北京时间凌晨发布的文章整体前移一天
      const day = isoDateInZone(date, SITE_TIME_ZONE)
      const year = day.slice(0, 4)
      const month = day.slice(0, 7)
      byYear.set(year, (byYear.get(year) ?? 0) + 1)
      byMonth.set(month, (byMonth.get(month) ?? 0) + 1)
      if (!firstDate || day < firstDate) firstDate = day
      if (!lastDate || day > lastDate) lastDate = day
    }

    const title = typeof post.data.title === 'string' ? post.data.title : post.path.filePath
    if (!longest || wordCount > longest.words) longest = { title, words: wordCount }
    if (!shortest || wordCount < shortest.words) shortest = { title, words: wordCount }
  }

  return {
    locale,
    label: LOCALES[locale].label,
    posts: posts.length,
    drafts,
    words,
    tags: tags.size,
    firstDate,
    lastDate,
    byYear,
    byMonth,
    longest,
    shortest,
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
  const locales: LocaleCode[] =
    localeOption === undefined ? [...LOCALE_CODES] : [parseLocale(localeOption)]

  const all = locales.map(statsOf)

  if (hasOption(args, 'json')) {
    console.log(
      JSON.stringify(
        all.map((stat) => ({
          locale: stat.locale,
          label: stat.label,
          posts: stat.posts,
          drafts: stat.drafts,
          words: stat.words,
          tags: stat.tags,
          firstDate: stat.firstDate,
          lastDate: stat.lastDate,
          byYear: Object.fromEntries(stat.byYear),
          byMonth: Object.fromEntries(stat.byMonth),
          longest: stat.longest,
          shortest: stat.shortest,
        })),
        null,
        2,
      ),
    )
    return
  }

  blank()

  const totalPosts = all.reduce((sum, stat) => sum + stat.posts, 0)
  const totalWords = all.reduce((sum, stat) => sum + stat.words, 0)

  console.log(
    `${c.bold('内容统计')} ${c.dim(`· ${totalPosts} 篇 · ${totalWords.toLocaleString('zh-CN')} 字`)}`,
  )
  blank()

  const overview = formatTable(
    [
      ['语言', '文章', '草稿', '字数', '标签', '时间跨度'],
      ...all.map((stat) => [
        `${stat.locale} ${c.dim(stat.label)}`,
        String(stat.posts),
        stat.drafts > 0 ? String(stat.drafts) : c.dim('0'),
        stat.words.toLocaleString('zh-CN'),
        String(stat.tags),
        stat.firstDate ? `${stat.firstDate} → ${stat.lastDate}` : c.dim('（无）'),
      ]),
    ],
    { headerRule: true },
  )
  for (const line of overview) info(`  ${line}`)
  blank()

  // 逐语言的年度 / 月度分布
  for (const stat of all) {
    if (stat.posts === 0) continue

    console.log(c.bold(`${stat.locale}`))
    blank()

    const years = [...stat.byYear.entries()].toSorted((a, b) => b[0].localeCompare(a[0]))
    info(`  ${c.dim('按年')}`)
    for (const [year, count] of years) {
      info(`    ${year}  ${c.cyan(bar(count, stat.posts))} ${count}`)
    }
    blank()

    const months = [...stat.byMonth.entries()]
      .toSorted((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 12)
    info(`  ${c.dim('按月（最近 12 个有文章的月）')}`)
    for (const [month, count] of months) {
      info(`    ${month}  ${c.cyan(bar(count, Math.max(...stat.byMonth.values())))} ${count}`)
    }
    blank()

    if (stat.longest && stat.shortest) {
      info(
        `  ${padEnd(c.dim('最长'), 8)}${stat.longest.title} ${c.dim(`（${stat.longest.words} 字）`)}`,
      )
      info(
        `  ${padEnd(c.dim('最短'), 8)}${stat.shortest.title} ${c.dim(`（${stat.shortest.words} 字）`)}`,
      )
      blank()
    }
  }
}

/** 画一个长度与数值成比例的方块条。 */
function bar(value: number, max: number): string {
  const width = max > 0 ? Math.max(1, Math.round((value / max) * 16)) : 0
  return '█'.repeat(width) + '░'.repeat(Math.max(0, 16 - width))
}
