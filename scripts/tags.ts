/**
 * `pnpm tags` —— 列出标签及其文章数。
 *
 * 直接用**文章里实际写了的标签原文**统计，而不是构建期的 `TAG_SLUGS` 映射表：
 * 标签没有独立文件，frontmatter 就是唯一来源（`WRITING.md` 的原话是
 * 「标签没有独立文件，改名就是改文章里的 frontmatter」）。
 *
 * 顺手做两件构建期不报、但实际会出事的一致性检查：
 * 同义标签（仅大小写/空白不同）会被标出来，因为它们会生成两个不同的标签页。
 */

import type { LocaleCode } from '../.vitepress/types'
import { hasOption, optionValue, parseArgs, wantsHelp } from './lib/args'
import { isoDateInZone } from './lib/dates'
import { collectPostFiles, postDate } from './lib/posts'
import { parseLocale, LOCALE_CODES, SITE_TIME_ZONE } from './lib/site'
import { blank, c, formatTable, helpLines, info } from './lib/ui'

/** 选项定义。 */
const SPECS = [
  { name: 'lang', short: 'l' },
  { name: 'json', boolean: true },
  { name: 'drafts', boolean: true },
  { name: 'help', short: 'h', boolean: true },
] as const

/** 帮助。 */
function printHelp(): void {
  helpLines(
    'pnpm tags',
    'pnpm tags [选项]',
    [
      { flag: '-l, --lang <code>', description: '只看某种语言的标签（默认逐语言列出）' },
      { flag: '--drafts', description: '把草稿的标签也算进来' },
      { flag: '--json', description: '输出 JSON' },
      { flag: '-h, --help', description: '显示本帮助' },
    ],
    ['pnpm tags', 'pnpm tags -l=zh-cn', 'pnpm tags --json'],
  )
}

/** 一个标签的聚合结果。 */
interface TagStat {
  tag: string
  count: number
  posts: { title: string; date: string }[]
}

/** 统计一种语言的标签。 */
function tagsOf(locale: LocaleCode, includeDrafts: boolean): TagStat[] {
  const posts = collectPostFiles(locale)
  const index = new Map<string, TagStat>()

  for (const post of posts) {
    if (!includeDrafts && post.data.draft === true) continue

    const rawTags = Array.isArray(post.data.tags) ? post.data.tags : []
    const title = typeof post.data.title === 'string' ? post.data.title : post.path.filePath
    // 不能直接读 data.date：gray-matter 已把它解析成 Date，typeof 不再是 string。
    // 按站点时区取日期，避免北京时间凌晨发布的文章排到前一天。
    const date = postDate(post)
    const day = date ? isoDateInZone(date, SITE_TIME_ZONE) : ''

    for (const raw of rawTags) {
      if (typeof raw !== 'string') continue
      const tag = raw.trim()
      if (tag === '') continue

      const existing = index.get(tag)
      if (existing) {
        existing.count += 1
        existing.posts.push({ title, date: day })
      } else {
        index.set(tag, { tag, count: 1, posts: [{ title, date: day }] })
      }
    }
  }

  return [...index.values()].toSorted((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

/** 找出仅大小写/空白不同的同义标签。 */
function findSynonyms(stats: TagStat[]): { canonical: string; variants: string[] }[] {
  const groups = new Map<string, string[]>()
  for (const stat of stats) {
    const key = stat.tag.toLowerCase().replace(/\s+/g, '')
    const list = groups.get(key)
    if (list) list.push(stat.tag)
    else groups.set(key, [stat.tag])
  }

  return [...groups.values()]
    .filter((variants) => variants.length > 1)
    .map((variants) => ({
      canonical: variants.toSorted()[0],
      variants: variants.toSorted(),
    }))
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
  const includeDrafts = hasOption(args, 'drafts')

  const data = locales.map((locale) => ({ locale, stats: tagsOf(locale, includeDrafts) }))

  if (hasOption(args, 'json')) {
    console.log(
      JSON.stringify(
        data.map(({ locale, stats }) => ({
          locale,
          tags: stats.map((stat) => ({ tag: stat.tag, count: stat.count })),
        })),
        null,
        2,
      ),
    )
    return
  }

  blank()

  for (const { locale, stats } of data) {
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

    // 同义标签会让同一主题裂成两个标签页，构建期不会报错，只能在这里提示
    const synonyms = findSynonyms(stats)
    if (synonyms.length > 0) {
      info(`  ${c.yellow('!')} 大小写/空白不一致的标签（会生成不同标签页）`)
      for (const { variants } of synonyms) {
        info(`    ${variants.join('  /  ')}`)
      }
      blank()
    }
  }
}
