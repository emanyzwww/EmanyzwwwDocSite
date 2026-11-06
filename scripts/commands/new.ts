/**
 * `pnpm doc new` —— 新建文章标准目录。
 *
 * 非交互（带任意参数）时直接创建；TTY 下裸调进入向导。
 *
 * 目录结构：
 *
 * ```text
 * docs/<YYYYMM>/<DDNN>/<lang>/index.md                       文章（frontmatter 全字段预填）
 * docs/<YYYYMM>/<DDNN>/<lang>/{images,audio,video,files}/    本语言资源目录（.gitkeep 占位）
 * docs/<YYYYMM>/<DDNN>/shared/{images,audio,video,files}/    跨语言共享资源目录（.gitkeep 占位）
 * ```
 *
 * 不写 `-l` 时创建**全部语言**（每个语言一份 `index.md`，标题相同）；
 * 交互向导默认只勾 `zh-cn`，并且**逐语言**询问标题与标签（中英标签各有一套）。
 * 标题留空时写空串，`doc check` 会提示补齐。
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
  { name: 'slug', short: 's' },
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
    { flag: '--no-assets', description: '不创建资源目录（images/audio/video/files）' },
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
  /**
   * 每种语言的标签。
   *
   * 必须**按语言分开存**：标签是内容的一部分，中文写「随笔」、英文写「Essay」，
   * 中英共用一份会直接把中文标签写进英文文章的 frontmatter。
   * 某语言没有条目 = 该语言没有标签（frontmatter 写空数组）。
   */
  tagsByLocale: Partial<Record<LocaleCode, string[]>>
  /**
   * 非交互模式下，哪些「本该逐语言」的值被原样复制给了本次创建的全部语言。
   * 只用于输出提醒（如 `-t` 标签、`--description`、`-s` slug），空数组 = 不提醒。
   */
  sharedAcrossLocales: string[]
  /** 目录日期；不写 `-d` 时为站点时区的今天。 */
  date: NewDateParts
  /** 用户是否显式指定了日期（决定 frontmatter 的 date 用哪天）。 */
  dateExplicit: boolean
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

  const parsedDate = parseNewDate(optionValue(args, 'date'))
  const explicitSequence = optionValue(args, 'sequence')
  if (explicitSequence !== undefined && !/^\d{2}$/.test(explicitSequence)) {
    throw new Error(`--sequence 需要两位数字，例如 01，收到：${explicitSequence}`)
  }
  const sequence = explicitSequence ?? parsedDate.sequence
  /*
   * 序号可以来自两处：`-n=03` 或 10 位日期 `-d=2026102403` 的后两位。
   * 两处都写且不一致时必须报错：静默采信其中一个，作者会得到一篇文章
   * 落在自己没预期的序号上（目录名一旦生成就很难发现）。
   */
  if (
    explicitSequence !== undefined &&
    parsedDate.sequence !== undefined &&
    explicitSequence !== parsedDate.sequence
  ) {
    throw new Error(
      `--sequence ${explicitSequence} 与 --date 里的序号 ${parsedDate.sequence} 冲突，只能写一个`,
    )
  }
  if (sequence !== undefined && (Number(sequence) < 1 || Number(sequence) > 99)) {
    throw new Error(`--sequence 只能是 01–99，收到：${sequence}`)
  }

  const targetLocales = scope.locales ?? [...LOCALE_CODES]
  const titles: Partial<Record<LocaleCode, string>> = {}
  const tagsByLocale: Partial<Record<LocaleCode, string[]>> = {}
  for (const locale of targetLocales) {
    titles[locale] = title
    // 非交互没有「逐语言询问」的机会：`-t` 的值写入本次创建的全部语言。
    // 中英标签通常不同（随笔 / Essay），多语言时由输出里的提示提醒作者分语言改。
    if (tags) tagsByLocale[locale] = tags
  }

  const description = optionValue(args, 'description')
  const slugOption = optionValue(args, 'slug')
  const sharedAcrossLocales: string[] = []
  if (targetLocales.length > 1) {
    if (tags) sharedAcrossLocales.push('标签')
    if (description !== undefined) sharedAcrossLocales.push('description')
    if (slugOption !== undefined) sharedAcrossLocales.push('slug')
  }

  return {
    locales: targetLocales,
    titles,
    tagsByLocale,
    sharedAcrossLocales,
    date: parsedDate,
    dateExplicit: optionValue(args, 'date') !== undefined,
    description,
    slug: slugOption,
    sequence,
    draft: hasOption(args, 'draft'),
    outline: !hasOption(args, 'no-outline'),
    into: intoValue === undefined ? undefined : parseInto(intoValue),
    tryRun: hasOption(args, 'try'),
    assets: !hasOption(args, 'no-assets'),
  }
}

/** 交互向导；用户在「确认创建」选「否」时返回 `null`。 */
async function collectInteractively(): Promise<NewInput | null> {
  const locales = await askMultiSelect<LocaleCode>(
    '为哪些语言创建？',
    [
      { value: 'zh-cn', label: '简体中文' },
      { value: 'en', label: 'English' },
    ],
    ['zh-cn'],
  )

  const titles: Partial<Record<LocaleCode, string>> = {}
  const tagsByLocale: Partial<Record<LocaleCode, string[]>> = {}
  for (const locale of locales) {
    // 标题与标签都必须**逐语言**问：中英标签是两套（随笔 / Essay），
    // 只问一次再共用，等于把中文标签写进英文文章的 frontmatter。
    // oxlint-disable-next-line no-await-in-loop
    titles[locale] = await askText(`${localeLabel(locale)}标题（留空则先空着）`)
    // oxlint-disable-next-line no-await-in-loop
    const tagsText = await askText(`${localeLabel(locale)}标签（逗号分隔，可留空）`)
    if (tagsText.trim() !== '') tagsByLocale[locale] = parseTagList(tagsText)
  }

  const today = nowInZone(SITE_TIME_ZONE)
  const dateText = await askText(
    '日期（YYYYMMDD 或 YYYYMMDDNN，留空=今天）',
    `${today.year}${today.month}${today.day}`,
  )
  const date = parseNewDate(dateText === '' ? undefined : dateText)

  const draft = await askConfirm('保存为草稿？', false)

  const tagsSummary = locales
    .map((locale) => `${locale}: ${tagsByLocale[locale]?.join('、') || '（无）'}`)
    .join('  ')

  p.note(
    [
      `${c.dim('语言')}  ${locales.join('、')}`,
      `${c.dim('日期')}  ${date.year}-${date.month}-${date.day}${date.sequence ? ` 第 ${date.sequence} 篇` : ''}`,
      `${c.dim('标题')}  ${locales.map((locale) => `${locale}: ${titles[locale] || '（空）'}`).join('  ')}`,
      `${c.dim('标签')}  ${tagsSummary}`,
      `${c.dim('草稿')}  ${draft ? '是' : '否'}`,
    ].join('\n'),
    '即将创建',
  )

  const confirmed = await askConfirm('确认创建？', true)
  if (!confirmed) {
    // 取消只结束本次创建，不结束整个进程：从 `pnpm doc` 主菜单进来时
    // 应当回到菜单（其它向导的取消行为也是如此）。退出码由调用方决定。
    p.cancel('已取消')
    return null
  }

  return {
    locales,
    titles,
    tagsByLocale,
    sharedAcrossLocales: [],
    date,
    dateExplicit: dateText !== '',
    description: undefined,
    slug: undefined,
    // 10 位日期（YYYYMMDDNN）自带当日序号，必须交回去；否则摘要写着「第 03 篇」，
    // 实际却按 01 分配。
    sequence: date.sequence,
    draft,
    outline: true,
    into: undefined,
    tryRun: false,
    assets: true,
  }
}

/**
 * 资源目录的四个类型，与 `docs/` 约定、`doc check` 的提示语保持一致。
 *
 * 图片只是最常用的一种；音频、视频、附件都各有自己的目录，`new` 一次建齐，
 * 作者不用再手工补目录（空目录靠 `.gitkeep` 进版本库）。
 */
const ASSET_DIRS = ['images', 'audio', 'video', 'files'] as const

/**
 * 创建资源目录（每个类型目录下放一个 `.gitkeep`，让空目录能进版本库）。
 *
 * 语言目录与 `shared/` 下各建一套：`<lang>/{images,audio,video,files}`
 * 放只属于该语言版本的资源，`shared/{images,audio,video,files}` 放中英共用的资源。
 *
 * 返回本次新建的 `.gitkeep` 路径，失败回滚时一并删除。
 */
function ensureAssetDirs(result: CreatePostResult): string[] {
  const created: string[] = []
  const targets = [
    ...ASSET_DIRS.map((name) => join(DOCS_DIR, result.languageDir, name)),
    ...ASSET_DIRS.map((name) => join(DOCS_DIR, result.articleDir, 'shared', name)),
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
      const tags = input.tagsByLocale[locale]

      const intoOption = input.into
        ? input.into
        : first !== null && !input.tryRun
          ? { month: first.month, daySeq: first.daySeq }
          : undefined
      /*
       * 序号只给「本次新建的文章目录」用。`--into` 直接指向已有目录，
       * 序号由目录决定，再传会与 `createPost` 的「--into 不能带序号」冲突
       * ——`--try` 预览多语言补写时最容易踩到，必须排除。
       */
      const sequenceOption =
        first === null ? input.sequence : input.tryRun && !input.into ? first.sequence : undefined

      const result = createPost({
        locale,
        year: first ? first.month.slice(0, 4) : input.date.year,
        month: first ? first.month.slice(4, 6) : input.date.month,
        day: first ? first.daySeq.slice(0, 2) : input.date.day,
        ...(intoOption ? { into: intoOption } : {}),
        ...(sequenceOption !== undefined ? { sequence: sequenceOption } : {}),
        ...(title === '' ? {} : { title }),
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(tags !== undefined ? { tags } : {}),
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

  // `--into` 可能把「本次创建的语言」过滤到只剩一个；只有真的同时创建多个语言时，
  // 「共享值」才需要提醒（否则会提示一件没发生的事）。
  if (input.sharedAcrossLocales.length > 0 && locales.length > 1) {
    blank()
    warn(
      `这些值已原样写入本次创建的全部语言（${locales.join('、')}）：` +
        `${input.sharedAcrossLocales.join('、')}；中英通常是两套，记得逐语言改` +
        '（交互向导可逐语言填标题与标签，摘要 / slug 建完再改）',
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
    const input = await collectInteractively()
    if (input === null) {
      // 独立运行时「取消」按中断处理；从主菜单进入时不会走到这里
      process.exitCode = 130
      return
    }
    await execute(input)
    return
  }

  await execute(collectFromArgs(args, parseScope(args)))
}

/** 供主菜单复用；取消时安静返回，由菜单决定是否继续。 */
export async function wizard(): Promise<void> {
  const input = await collectInteractively()
  if (input !== null) await execute(input)
}
