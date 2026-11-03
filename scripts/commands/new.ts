/**
 * `pnpm doc new` —— 新建文章标准目录。
 *
 * 非交互（带任意参数）时直接创建；TTY 下裸调进入向导。
 *
 * 目录结构：
 *
 * ```text
 * docs/<YYYYMM>/<DDNN>/<lang>/index.md     文章（frontmatter 全字段预填）
 * docs/<YYYYMM>/<DDNN>/<lang>/images/      本语言资源目录（.gitkeep 占位）
 * docs/<YYYYMM>/<DDNN>/shared/images/      跨语言共享资源目录（.gitkeep 占位）
 * ```
 *
 * 不写 `-l` 时创建**全部语言**（每个语言一份 `index.md`，标题相同）；
 * 交互向导默认只勾 `zh-cn`。标题留空时写空串，`doc check` 会提示补齐。
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { LocaleCode } from '../../.vitepress/types'
import { hasOption, optionValue, type CliArgs, type OptionSpec } from '../lib/args'
import {
  parseCommandArgs,
  parseScope,
  printCommandHelp,
  shouldWizard,
  wantsCommandHelp,
  type CommandMeta,
} from '../lib/cli'
import { createPost, type CreatePostResult } from '../lib/create'
import { nowInZone, zonedOffset } from '../lib/dates'
import {
  localeLabel,
  parseNewDate,
  parseTagList,
  type NewDateParts,
  type Scope,
} from '../lib/filters'
import { articleDirLocales } from '../lib/posts'
import { askConfirm, askMultiSelect, askText, p } from '../lib/prompt'
import { DOCS_DIR, LOCALE_CODES, SITE_TIME_ZONE } from '../lib/site'
import { blank, c, info, success, warn } from '../lib/ui'

/** 命令自己的选项（全局参数由 cli 自动拼上）。 */
const SPECS: readonly OptionSpec[] = [
  { name: 'slug' },
  { name: 'description' },
  { name: 'sequence', short: 'n' },
  { name: 'into' },
  { name: 'draft', boolean: true },
  { name: 'no-outline', boolean: true },
  { name: 'no-assets', boolean: true },
  { name: 'try', boolean: true },
]

/** 帮助信息。 */
export const meta: CommandMeta = {
  name: 'new',
  summary: '新建文章标准目录与 frontmatter',
  usage: 'new [标题] [参数]',
  options: [
    { flag: '-s, --slug <slug>', description: 'URL 段落；不写则由标题推导' },
    { flag: '--description <文本>', description: '一句话摘要' },
    { flag: '-n, --sequence <NN>', description: '指定当日序号（01–99）' },
    { flag: '--into <YYYYMM/DDNN>', description: '写入已有文章目录（补语言版）' },
    { flag: '--draft', description: '标记为草稿（draft: true）' },
    { flag: '--no-outline', description: '关闭右栏目录（outline: false）' },
    { flag: '--no-assets', description: '不创建 images/ 资源目录' },
    { flag: '--try', description: '只打印将生成的内容，不写盘' },
  ],
  examples: [
    'pnpm doc new "你好，世界" -l=zh-cn -t=随笔',
    'pnpm doc new "Hello" -l=en',
    'pnpm doc new "补记" -d=20261024 -n=02',
    'pnpm doc new "Hi" -l=en --into 202610/1901',
    'pnpm doc new --try',
  ],
}

/** 一次创建所需的全部输入。 */
interface NewInput {
  locales: LocaleCode[]
  /** 每种语言的标题；缺省为空串。 */
  titles: Partial<Record<LocaleCode, string>>
  /** 目录日期；不写 `-d` 时为站点时区的今天。 */
  date: NewDateParts
  /** 用户是否显式指定了日期（决定 frontmatter 的 date 用哪天）。 */
  dateExplicit: boolean
  tags: string[] | undefined
  description: string | undefined
  slug: string | undefined
  sequence: string | undefined
  draft: boolean
  outline: boolean
  into: { month: string; daySeq: string } | undefined
  tryRun: boolean
  assets: boolean
}

/** 解析 `--into <YYYYMM>/<DDNN>`，并把非法值提前拦下。 */
function parseInto(value: string): { month: string; daySeq: string } {
  const matched = /^(\d{6})\/(\d{4})$/.exec(value)
  if (!matched) {
    throw new Error(
      `--into 需要 <YYYYMM>/<DDNN>（6 位年月 / 4 位日序号），如 202610/1901，收到：${value}`,
    )
  }

  const [, month, daySeq] = matched
  if (Number(month.slice(4)) < 1 || Number(month.slice(4)) > 12) {
    throw new Error(`--into 的月份不合法：${month}（01–12）`)
  }
  const day = Number(daySeq.slice(0, 2))
  const sequence = Number(daySeq.slice(2))
  if (day < 1 || day > 31) throw new Error(`--into 的日期不合法：${daySeq}（01–31）`)
  if (sequence < 1 || sequence > 99) {
    throw new Error(`--into 的当日序号不合法：${daySeq.slice(2)}（01–99）`)
  }
  return { month, daySeq }
}

/** 从命令行参数收集输入。 */
function collectFromArgs(args: CliArgs, scope: Scope): NewInput {
  if (args.positionals.length > 1) {
    throw new Error(`new 只接受一个标题位置参数，收到：${args.positionals.join(' ')}`)
  }
  const title = args.positionals[0] ?? ''

  if (scope.tag.mode === 'bare') {
    throw new Error('new 的 -t/--tag 需要值，例如 -t=随笔')
  }
  const tags = scope.tag.mode === 'some' ? scope.tag.tags : undefined

  const intoValue = optionValue(args, 'into')
  if (intoValue !== undefined) {
    if (optionValue(args, 'date') !== undefined) {
      throw new Error('--into 已指定文章目录，不能再传 --date')
    }
    if (optionValue(args, 'sequence') !== undefined) {
      throw new Error('--into 已指定文章目录，不能再传 --sequence')
    }
  }

  const sequence = optionValue(args, 'sequence')
  if (sequence !== undefined && !/^\d{2}$/.test(sequence)) {
    throw new Error(`--sequence 需要两位数字，例如 01，收到：${sequence}`)
  }

  const targetLocales = scope.locales ?? [...LOCALE_CODES]
  const titles: Partial<Record<LocaleCode, string>> = {}
  for (const locale of targetLocales) titles[locale] = title

  return {
    locales: targetLocales,
    titles,
    date: parseNewDate(optionValue(args, 'date')),
    dateExplicit: optionValue(args, 'date') !== undefined,
    tags,
    description: optionValue(args, 'description'),
    slug: optionValue(args, 'slug'),
    sequence,
    draft: hasOption(args, 'draft'),
    outline: !hasOption(args, 'no-outline'),
    into: intoValue === undefined ? undefined : parseInto(intoValue),
    tryRun: hasOption(args, 'try'),
    assets: !hasOption(args, 'no-assets'),
  }
}

/** 交互向导。 */
async function collectInteractively(): Promise<NewInput> {
  const locales = await askMultiSelect<LocaleCode>(
    '为哪些语言创建？',
    [
      { value: 'zh-cn', label: '简体中文' },
      { value: 'en', label: 'English' },
    ],
    ['zh-cn'],
  )

  const titles: Partial<Record<LocaleCode, string>> = {}
  for (const locale of locales) {
    // 标题要一种语言一种语言地问，不能并行弹窗
    // oxlint-disable-next-line no-await-in-loop
    titles[locale] = await askText(`${localeLabel(locale)}标题（留空则先空着）`)
  }

  const today = nowInZone(SITE_TIME_ZONE)
  const dateText = await askText(
    '日期（YYYYMMDD 或 YYYYMMDDNN，留空=今天）',
    `${today.year}${today.month}${today.day}`,
  )
  const date = parseNewDate(dateText === '' ? undefined : dateText)

  const tagsText = await askText('标签（逗号分隔，可留空）')
  const draft = await askConfirm('保存为草稿？', false)

  p.note(
    [
      `${c.dim('语言')}  ${locales.join('、')}`,
      `${c.dim('日期')}  ${date.year}-${date.month}-${date.day}${date.sequence ? ` 第 ${date.sequence} 篇` : ''}`,
      `${c.dim('标题')}  ${locales.map((locale) => `${locale}: ${titles[locale] || '（空）'}`).join('  ')}`,
      `${c.dim('标签')}  ${tagsText || '（无）'}`,
      `${c.dim('草稿')}  ${draft ? '是' : '否'}`,
    ].join('\n'),
    '即将创建',
  )

  const confirmed = await askConfirm('确认创建？', true)
  if (!confirmed) {
    p.cancel('已取消')
    process.exit(130)
  }

  return {
    locales,
    titles,
    date,
    dateExplicit: dateText !== '',
    tags: tagsText === '' ? undefined : parseTagList(tagsText),
    description: undefined,
    slug: undefined,
    sequence: undefined,
    draft,
    outline: true,
    into: undefined,
    tryRun: false,
    assets: true,
  }
}

/**
 * 创建资源目录（`images/` 下放一个 `.gitkeep`，让空目录能进版本库）。
 *
 * 返回本次新建的 `.gitkeep` 路径，失败回滚时一并删除。
 */
function ensureAssetDirs(result: CreatePostResult): string[] {
  const created: string[] = []
  const targets = [
    join(DOCS_DIR, result.languageDir, 'images'),
    join(DOCS_DIR, result.articleDir, 'shared', 'images'),
  ]
  for (const dir of targets) {
    mkdirSync(dir, { recursive: true })
    const keep = join(dir, '.gitkeep')
    if (!existsSync(keep)) {
      writeFileSync(keep, '', 'utf-8')
      created.push(keep)
    }
  }
  return created
}

/** 创建过程中写出的文件，失败时用于回滚。 */
function rollback(files: string[], dirs: string[]): void {
  for (const file of files) rmSync(file, { force: true })
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
}

/**
 * 把「今天的时刻」搬到指定的年月日上。
 *
 * `-d=20261024` 表示这篇文章属于那一天：目录、frontmatter 的 `date` 都应对齐，
 * 否则 `doc check` 会报「目录日期与 date 不一致」。时刻仍取当前时间。
 */
function dateAtCurrentTime(parts: NewDateParts): Date {
  const current = nowInZone(SITE_TIME_ZONE)
  const offset = zonedOffset(new Date(), SITE_TIME_ZONE)
  return new Date(
    `${parts.year}-${parts.month}-${parts.day}T${current.hour}:${current.minute}:${current.second}${offset}`,
  )
}

/** 执行创建并打印结果。 */
async function execute(input: NewInput): Promise<void> {
  const now = input.dateExplicit && !input.into ? dateAtCurrentTime(input.date) : new Date()

  // `--into` 指向已有目录：只补还没有的语言版本
  let locales = input.locales
  if (input.into) {
    const existing = articleDirLocales(input.into.month, input.into.daySeq)
    locales = locales.filter((locale) => !existing.includes(locale))
    if (locales.length === 0) {
      throw new Error(
        `文章目录 ${input.into.month}/${input.into.daySeq} 里这些语言的 index.md 都已存在：` +
          input.locales.join('、'),
      )
    }
    if (locales.length < input.locales.length) {
      warn(
        `已有语言版本，跳过：${input.locales.filter((code) => !locales.includes(code)).join('、')}`,
      )
    }
  }

  const results: CreatePostResult[] = []
  const createdFiles: string[] = []
  const createdDirs: string[] = []
  let first: CreatePostResult | null = null

  try {
    for (const locale of locales) {
      const title = input.titles[locale] ?? ''

      const intoOption = input.into
        ? input.into
        : first !== null && !input.tryRun
          ? { month: first.month, daySeq: first.daySeq }
          : undefined
      const sequenceOption =
        first === null ? input.sequence : input.tryRun ? first.sequence : undefined

      const result = createPost({
        locale,
        year: first ? first.month.slice(0, 4) : input.date.year,
        month: first ? first.month.slice(4, 6) : input.date.month,
        day: first ? first.daySeq.slice(0, 2) : input.date.day,
        ...(intoOption ? { into: intoOption } : {}),
        ...(sequenceOption !== undefined ? { sequence: sequenceOption } : {}),
        ...(title === '' ? {} : { title }),
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        draft: input.draft,
        outline: input.outline,
        now,
        dryRun: input.tryRun,
      })

      if (result.written) {
        createdFiles.push(result.absolutePath)
        if (result.isNewArticleDir) createdDirs.push(join(DOCS_DIR, result.articleDir))
        if (input.assets) createdFiles.push(...ensureAssetDirs(result))
      }

      results.push(result)
      first ??= result
    }
  } catch (error) {
    rollback(createdFiles, createdDirs)
    throw error
  }

  // ---------- 输出 ----------
  blank()
  if (input.tryRun) {
    warn('--try：以下内容不会写入磁盘')
    blank()
    for (const result of results) {
      console.log(c.dim(`──────────── ${result.filePath} ────────────`))
      console.log(result.content.trimEnd())
      console.log(c.dim('──────────────────────────────────────────'))
      blank()
    }
  } else {
    for (const result of results) {
      success(`已创建 ${c.cyan(result.filePath)}`)
    }
    blank()
  }

  const head = first
  if (head) {
    if (input.into) {
      info(`${c.dim('日期')}      继承自 ${head.articleDir}`)
    } else {
      info(
        `${c.dim('日期')}      ${input.date.year}-${input.date.month}-${input.date.day}（${SITE_TIME_ZONE}）`,
      )
    }
    info(`${c.dim('文章目录')}  ${head.articleDir}`)
    info(`${c.dim('序号')}      ${head.sequence}`)
    for (const result of results) {
      info(`${c.dim('语言')}      ${result.locale}  ${c.dim('slug')} ${result.slug || '（空）'}`)
      info(`${c.dim('URL')}       ${result.url}`)
    }
  }

  const emptyTitleLocales = locales.filter((locale) => (input.titles[locale] ?? '') === '')
  if (emptyTitleLocales.length > 0) {
    blank()
    warn(
      `标题留空：${emptyTitleLocales.join('、')} 的 title/slug 为空串，写完记得补齐（doc check 会提示）`,
    )
  }

  // 已有语言 + 本次创建的语言；`--into` 时还要算上目标目录里原来的版本
  const present = new Set<LocaleCode>(locales)
  if (input.into) {
    for (const code of articleDirLocales(input.into.month, input.into.daySeq)) present.add(code)
  }
  const missing = LOCALE_CODES.filter((code) => !present.has(code))
  if (missing.length > 0 && head) {
    blank()
    info(
      `${c.dim('未创建')}  ${missing.join('、')} 版本；补写：` +
        `pnpm doc new -l=${missing[0]} --into ${head.articleDir}`,
    )
  }

  if (!input.tryRun) {
    blank()
    info(c.dim('下一步'))
    info(`  ${c.dim('1.')} 编辑上面的 index.md，补标题与正文`)
    info(`  ${c.dim('2.')} pnpm doc check 确认元字段`)
    blank()
    warn('新增文章后需要重启 pnpm dev：rewrites 在启动时解析（线上构建无影响）')
  }
  blank()
}

/** 命令入口。 */
export default async function main(argv: string[]): Promise<void> {
  const args = parseCommandArgs(argv, SPECS)
  if (wantsCommandHelp(args)) {
    printCommandHelp(meta)
    return
  }

  if (shouldWizard(argv)) {
    await execute(await collectInteractively())
    return
  }

  await execute(collectFromArgs(args, parseScope(args)))
}

/** 供主菜单复用。 */
export async function wizard(): Promise<void> {
  await execute(await collectInteractively())
}
