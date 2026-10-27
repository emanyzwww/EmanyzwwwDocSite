/**
 * `pnpm new` —— 新建一篇文章。
 *
 * 默认行为：按**北京时间**算出今天的 年/月/日，扫当月目录分配当日序号，
 * 生成 `docs/<lang>/<YYYYMM>/<DDNN>/index.md`，并把 frontmatter 的**全部字段**
 * 一次补齐（含由标题推导的 `slug`）。
 *
 * 目录里不再有标题：URL 由「目录 + slug」拼成 `/zh-cn/202610/1901/<slug>/`，
 * 该映射由 `.vitepress/config.ts` 的 `rewrites` 在**启动时**解析，
 * 因此新增文章后需要重启 `pnpm dev`（线上构建每次都会重新解析，无影响）。
 */

import { relative } from 'node:path'

import { slugify } from '../.vitepress/support/slug'
import { hasOption, optionValue, parseArgs, wantsHelp } from './lib/args'
import { createPost } from './lib/create'
import { nowInZone } from './lib/dates'
import { existingMonthDirs } from './lib/posts'
import { parseLocale, REPO_ROOT, SITE_TIME_ZONE } from './lib/site'
import { blank, c, helpLines, info, success, warn } from './lib/ui'

/** 选项定义。 */
const SPECS = [
  { name: 'lang', short: 'l' },
  { name: 'title', short: 't' },
  { name: 'slug', short: 's' },
  { name: 'tags' },
  { name: 'description', short: 'd' },
  { name: 'date' },
  { name: 'sequence', short: 'n' },
  { name: 'draft', boolean: true },
  { name: 'no-outline', boolean: true },
  { name: 'dry-run', boolean: true },
  { name: 'help', short: 'h', boolean: true },
] as const

/** 帮助。 */
function printHelp(): void {
  helpLines(
    'pnpm new',
    'pnpm new [选项]',
    [
      { flag: '-l, --lang <code>', description: '语言：zh-cn（默认）或 en' },
      { flag: '-t, --title <文本>', description: '文章标题（也用于推导 slug）' },
      { flag: '-s, --slug <段落>', description: 'URL 段落（slug），不写则由标题推导' },
      { flag: '--tags <a,b>', description: '标签，逗号分隔，如 随笔,工具' },
      { flag: '-d, --description <文本>', description: '一句话摘要' },
      { flag: '--date <YYYYMMDD>', description: '指定日期，默认取北京时间当天' },
      { flag: '-n, --sequence <NN>', description: '指定当日序号，默认自动分配（01、02…）' },
      { flag: '--draft', description: '标记为草稿（draft: true）' },
      { flag: '--no-outline', description: '关闭右栏目录（outline: false）' },
      { flag: '--dry-run', description: '只打印将要创建的内容，不写盘' },
      { flag: '-h, --help', description: '显示本帮助' },
    ],
    [
      'pnpm new -l=zh-cn',
      'pnpm new --title="我的新文章" --tags=随笔,工具',
      'pnpm new -l=en -t="My New Post" --draft',
      'pnpm new -t="重构说明" -s=refactor-notes',
    ],
  )
}

/** 解析逗号分隔的标签。 */
function parseTags(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined
  const tags = value
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
  return tags.length > 0 ? tags : undefined
}

/** 解析 `--date 20261024`。 */
function parseDateOption(
  value: string | undefined,
): { year: string; month: string; day: string } | null {
  if (value === undefined) return null
  if (!/^\d{8}$/.test(value)) {
    throw new Error(`--date 需要 8 位数字 YYYYMMDD，例如 20261024，收到：${value}`)
  }
  return { year: value.slice(0, 4), month: value.slice(4, 6), day: value.slice(6, 8) }
}

/** 命令主体。 */
export default function main(argv: string[]): void {
  const args = parseArgs(argv, [...SPECS])
  if (wantsHelp(args)) {
    printHelp()
    return
  }

  const locale = parseLocale(optionValue(args, 'lang'))
  const explicitDate = parseDateOption(optionValue(args, 'date'))

  // 「今天」必须按站点时区算，而不是运行机器的本地时区（见 lib/dates.ts）
  const today = nowInZone(SITE_TIME_ZONE)
  const dateParts = explicitDate ?? { year: today.year, month: today.month, day: today.day }
  const month = `${dateParts.year}${dateParts.month}`

  // 创建前的当月篇数，用于提示（创建后目录数会 +1，不适合反过来数）
  const monthPostsBefore = existingMonthDirs(locale, month).length

  const title = optionValue(args, 'title')
  const slugOption = optionValue(args, 'slug')
  const sequenceOption = optionValue(args, 'sequence')

  if (sequenceOption !== undefined && !/^\d{2}$/.test(sequenceOption)) {
    throw new Error(`--sequence 需要两位数字，例如 01，收到：${sequenceOption}`)
  }

  const dryRun = hasOption(args, 'dry-run')

  const result = createPost({
    locale,
    ...dateParts,
    ...(title !== undefined ? { title } : {}),
    ...(slugOption !== undefined ? { slug: slugOption } : {}),
    ...(sequenceOption !== undefined ? { sequence: sequenceOption } : {}),
    ...(parseTags(optionValue(args, 'tags')) !== undefined
      ? { tags: parseTags(optionValue(args, 'tags'))! }
      : {}),
    ...(optionValue(args, 'description') !== undefined
      ? { description: optionValue(args, 'description')! }
      : {}),
    draft: hasOption(args, 'draft'),
    outline: !hasOption(args, 'no-outline'),
    dryRun,
  })

  const shownPath = relative(REPO_ROOT, result.absolutePath).split('\\').join('/')

  blank()
  if (dryRun) {
    warn('dry-run：以下内容不会写入磁盘')
    blank()
    console.log(c.dim('──────────── index.md ────────────'))
    console.log(result.content.trimEnd())
    console.log(c.dim('──────────────────────────────────'))
    blank()
  } else {
    success(`已创建 ${c.cyan(shownPath)}`)
    blank()
  }

  info(`${c.dim('语言')}  ${locale}`)
  info(
    `${c.dim('日期')}  ${dateParts.year}-${dateParts.month}-${dateParts.day}（${SITE_TIME_ZONE}）`,
  )
  info(`${c.dim('目录')}  ${result.month}/${result.daySeq}`)
  info(`${c.dim('序号')}  ${result.sequence}`)
  info(`${c.dim('slug')}  ${result.slug}`)
  info(`${c.dim('URL')}   ${result.url}`)
  info(`${c.dim('本月')}  ${month} 已有 ${monthPostsBefore} 篇${dryRun ? '' : '（不含本次）'}`)
  info(`${c.dim('标题')}  ${title ?? '（未命名文章，请自行修改）'}`)

  if (title === undefined) {
    blank()
    warn('没有传 --title，已写入占位标题「未命名文章」与占位 slug')
  }
  if (slugOption === undefined && title !== undefined && slugify(title) === '') {
    blank()
    warn('标题无法推导出 slug（全是标点），已回退为 untitled')
  }

  if (!dryRun) {
    blank()
    info(c.dim('下一步'))
    info(`  ${c.dim('1.')} 编辑上面那个 index.md，写标题与正文`)
    info(
      `  ${c.dim('2.')} pnpm posts ${dateParts.year}${dateParts.month}${dateParts.day} 确认已收录`,
    )
    blank()
    warn('新增文章后需要重启 pnpm dev：rewrites 在启动时解析，不重启看不到新 URL（线上构建无影响）')
  }
  blank()
}
