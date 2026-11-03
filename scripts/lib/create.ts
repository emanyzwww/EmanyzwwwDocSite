/**
 * 新建文章：分配「当日序号」、决定 slug、拼出完整 frontmatter。
 *
 * 目录布局是唯一形态 `docs/<YYYYMM>/<DDNN>/<lang>/index.md`：
 * 一篇文章 = 一个 `<YYYYMM>/<DDNN>` 目录，语言版本是目录里的 `<lang>/index.md`。
 * 因此序号是**全天全局**的（中英两边共享同一个号，不是各排一套），
 * 规则（用户要求「默认从 01 开始往后延 02、03」）：
 * - 扫**目录名**而不是 frontmatter 来决定下一个号，因为目录才是序号的载体；
 * - 已占用号里取最大值 +1，但中间出现空洞时**优先补空洞**（`01`、`03` 存在 → 用 `02`），
 *   这样删错重发不会留下永久空洞；
 * - 超过 `99` 直接报错，而不是悄悄变成三位（那会破坏 `NN` 的定长约定）。
 *
 * 三种创建方式：
 * 1. **自动分配**（默认）：找当天第一个空号，永不落到已有目录上；
 * 2. **显式序号**（`-n 03`）：目录不存在则新建；目录已存在但本语言还没写
 *    `index.md` 时视为「补翻译」，允许写入；本语言已存在则报错；
 * 3. **指定目录**（`--into 202610/1901`）：不分配序号，直接在已有文章目录里
 *    写当前语言版本（补翻译的主要用法）。
 *
 * 默认**只建当前语言**：另一语言的 `index.md` 由作者按需补（`--into`），
 * `shared/` 也只在真的需要跨语言共享资源时才由作者创建。
 *
 * slug 只写进 frontmatter，**不再参与目录名**：标题与 URL 段落解耦后，
 * 改标题/改 URL 不需要移动文件（URL 由 `rewrites` 从目录 + slug 拼出）。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { articleUrlPath } from '../../.vitepress/support/article-path'
import { isUsableSlug, slugify } from '../../.vitepress/support/slug'
import type { LocaleCode } from '../../.vitepress/types'
import { formatZonedIso } from './dates'
import { rawScalarValue, stringifyFrontmatter } from './frontmatter'
import { FRONTMATTER_FIELDS } from './frontmatter-schema'
import { articleDirLocales, usedSequences } from './posts'
import { DOCS_DIR, isDirectory, SITE_TIME_ZONE } from './site'

/** 序号上限：`NN` 是两位，`99` 之后再没有位置。 */
const MAX_SEQUENCE = 99

/** `--into` 指定目录时，年月段必须是 6 位数字（`YYYYMM`）。 */
const INTO_MONTH_RE = /^\d{6}$/

/** `--into` 指定目录时，日序号段必须是 4 位数字（`DDNN`）。 */
const INTO_DAY_SEQ_RE = /^\d{4}$/

/** 新建文章的选项。 */
export interface CreatePostOptions {
  locale: LocaleCode
  /** 目录日期的年。 */
  year: string
  /** 目录日期的月（两位）。 */
  month: string
  /** 目录日期的日（两位）。 */
  day: string
  /** 标题；留空则用占位标题。 */
  title?: string
  /** URL 段落（frontmatter 的 `slug`）；留空则由标题推导。 */
  slug?: string
  /** 指定当日序号（`01`）；留空则自动分配。 */
  sequence?: string
  /**
   * 直接写入已有文章目录（`--into <YYYYMM/DDNN>`），不再分配序号。
   *
   * 这是「补翻译」的主路径：另一语言已经建好 `docs/<YYYYMM>/<DDNN>/`，
   * 现在写它的 `<lang>/index.md`。目录必须已存在——`--into` 拼错时
   * 报错比悄悄新建一个空目录安全。
   */
  into?: { month: string; daySeq: string }
  /** 标签。 */
  tags?: string[]
  /** 摘要；留空则留空字符串（构建期回退到正文第一段）。 */
  description?: string
  /** 是否草稿。 */
  draft?: boolean
  /** 是否显示右栏目录。 */
  outline?: boolean
  /** 用于生成 `date` 的时刻，默认当前时间。 */
  now?: Date
  /** 内容根目录，默认仓库 `docs/`；可传入其它目录做临时验证。 */
  docsDir?: string
  /** 只计算不落盘（`--try` 用）。 */
  dryRun?: boolean
}

/** 新建结果。 */
export interface CreatePostResult {
  /** 这篇文章的语言版本。 */
  locale: LocaleCode
  /** 相对 `docs/` 的源文件路径：`<YYYYMM>/<DDNN>/<lang>/index.md`。 */
  filePath: string
  /** 绝对路径。 */
  absolutePath: string
  /** 文章目录 `<YYYYMM>/<DDNN>`（中英共享，跨语言配对键就是它）。 */
  articleDir: string
  /** 语言目录 `<YYYYMM>/<DDNN>/<lang>`。 */
  languageDir: string
  /** 年月目录，如 `202610`。 */
  month: string
  /** 日 + 序号目录，如 `1901`。 */
  daySeq: string
  /** 分配的当日序号，如 `01`。 */
  sequence: string
  /** 实际使用的 slug（frontmatter 的 `slug`）。 */
  slug: string
  /** 站点路径（未编码）：`/zh-cn/202610/1901/你好，世界/`。 */
  url: string
  /** 写入的文件内容。 */
  content: string
  /** 是否真的写了盘。 */
  written: boolean
  /** 写入前该文章目录已有的语言（用于提示「补的是哪一篇的翻译」）。 */
  existingLocales: LocaleCode[]
  /** 是否新建了文章目录（`true` = 这个 `<YYYYMM>/<DDNN>` 之前不存在）。 */
  isNewArticleDir: boolean
}

/**
 * 分配当日序号。
 *
 * @param used 当天已占用的序号（`01`、`02`…）。
 */
export function nextSequence(used: ReadonlySet<string>): string {
  const numbers = [...used]
    .filter((sequence) => /^\d{2}$/.test(sequence))
    .map((sequence) => Number(sequence))
    .toSorted((a, b) => a - b)

  // 优先补空洞：1..max 里第一个缺失的号
  if (numbers.length > 0) {
    const max = numbers[numbers.length - 1]
    for (let candidate = 1; candidate <= max; candidate += 1) {
      if (!numbers.includes(candidate)) return pad2(candidate)
    }
    const next = max + 1
    if (next > MAX_SEQUENCE) {
      throw new Error(`当天已有 ${max} 篇，超过两位序号上限 ${MAX_SEQUENCE}，无法再分配`)
    }
    return pad2(next)
  }

  return pad2(1)
}

/** 数字补到两位。 */
function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * 组装完整的 frontmatter 数据。
 *
 * **全部字段都写上**（这是用户明确要求的「全部补上」），包括可选字段。
 * 可选字段被显式写成默认值，比省略更清楚：读者一眼能看到有哪些开关可调，
 * 不需要再去翻 `WRITING.md` 才知道存在这个字段。
 *
 * `slug` 必须给真实值：空串在 YAML 里是有效值，但会让 URL 段落变成空、
 * 构建期还要再推导一次，等于把决策推迟到构建阶段。
 */
export function buildFrontmatterData(options: {
  title: string
  slug: string
  date: string
  tags?: string[]
  description?: string
  draft?: boolean
  outline?: boolean
}): Record<string, unknown> {
  const data: Record<string, unknown> = {}

  for (const field of FRONTMATTER_FIELDS) {
    switch (field.key) {
      case 'title':
        data.title = options.title
        break
      case 'slug':
        data.slug = options.slug
        break
      case 'date':
        data.date = options.date
        break
      case 'tags':
        data.tags = options.tags ?? []
        break
      case 'description':
        data.description = options.description ?? ''
        break
      case 'draft':
        data.draft = options.draft ?? false
        break
      case 'outline':
        data.outline = options.outline ?? true
        break
      default:
        break
    }
  }

  return data
}

/**
 * 正文初始模板。
 *
 * 带一个 H2 占位而不是留空：没有任何标题时，右栏目录是空的、页面看上去像出错。
 * 故意**不写 H1**——标题由 frontmatter 的 `title` 生成（`WRITING.md` 的硬规则）。
 */
function initialBody(): string {
  return '正文从这里开始。\n\n## 第一个小标题\n\n内容。\n'
}

/**
 * 决定最终 slug。
 *
 * 显式传了 `--slug` 就用它（但必须可用）；否则由标题推导，推导不出来回退
 * `untitled`。不可用的显式值直接报错，而不是悄悄换掉——那会生成一个
 * 作者没预期的 URL，事后很难发现。
 */
function resolveSlug(slugOption: string | undefined, title: string): string {
  const explicit = slugOption?.trim() ?? ''
  if (explicit !== '' && !isUsableSlug(explicit)) {
    throw new Error(`slug 不可用：${explicit}（不能含空格、斜杠、方括号等会破坏 URL 的字符）`)
  }

  // 标题与 slug 都留空时，就写空串：作者先建骨架、稍后补标题，
  // 构建期 `slugOf()` 会回退到 `untitled`，不会产出坏 URL。
  if (explicit !== '' || title.trim() === '') return explicit

  const derived = slugify(title)
  return isUsableSlug(derived) ? derived : 'untitled'
}

/**
 * 决定这次要写的「文章目录」。
 *
 * 返回的 `isNewArticleDir` 同时告诉调用方：这次是新建一篇，还是给已有文章
 * 补一个语言版本——`new` 的提示语、写作建议都靠它区分。
 */
function resolveArticleDir(
  options: CreatePostOptions,
  docsDir: string,
): { month: string; daySeq: string; sequence: string; isNewArticleDir: boolean } {
  if (options.into) {
    const { month, daySeq } = options.into
    // 序号由目录决定，再给一个 --sequence 只会让人以为它生效；直接拒绝
    if (options.sequence !== undefined) {
      throw new Error(
        `已用 --into 指定文章目录 ${month}/${daySeq}，不能再指定序号 ${options.sequence}`,
      )
    }
    if (!INTO_MONTH_RE.test(month)) {
      throw new Error(`文章目录的年月段应为 6 位数字 YYYYMM，收到：${month}`)
    }
    if (!INTO_DAY_SEQ_RE.test(daySeq)) {
      throw new Error(`文章目录的日序号段应为 4 位数字 DDNN，收到：${daySeq}`)
    }
    if (!isDirectory(join(docsDir, month, daySeq))) {
      throw new Error(`文章目录不存在：${month}/${daySeq}（--into 只能指向已存在的目录）`)
    }
    return { month, daySeq, sequence: daySeq.slice(2), isNewArticleDir: false }
  }

  const month = `${options.year}${options.month}`

  if (options.sequence !== undefined) {
    if (!/^\d{2}$/.test(options.sequence)) {
      throw new Error(`序号需要两位数字，例如 01，收到：${options.sequence}`)
    }

    /*
     * 显式序号落在已有目录上时有两种可能：
     * - 本语言的 index.md 已存在 → 真撞号，必须报错（两篇文章会共用 URL 前缀）；
     * - 只是另一语言已经建好 → 这是「补翻译」，允许写入。
     * 自动分配（未给 sequence）走 nextSequence，天然不会落到已有目录。
     */
    const daySeq = `${options.day}${options.sequence}`
    if (articleDirLocales(month, daySeq, docsDir).includes(options.locale)) {
      throw new Error(
        `序号 ${options.sequence} 已被占用：${month}/${daySeq}/${options.locale}/index.md 已存在` +
          `（补另一语言请用 --into ${month}/${daySeq}）`,
      )
    }
    return {
      month,
      daySeq,
      sequence: options.sequence,
      isNewArticleDir: !isDirectory(join(docsDir, month, daySeq)),
    }
  }

  // 自动分配：nextSequence 只会给「没被任何目录占用」的号，天然不会复用已有目录
  const used = usedSequences(month, options.day, docsDir)
  const sequence = nextSequence(used)
  const daySeq = `${options.day}${sequence}`
  return { month, daySeq, sequence, isNewArticleDir: !isDirectory(join(docsDir, month, daySeq)) }
}

/**
 * 给已有文章补语言版本时，发布时刻必须继承同目录另一语言版本。
 *
 * 同一篇内容的各语言版本是同一时刻发布的：沿用「当前时刻」会让两边的
 * `date` 不同，`pnpm doc check` 会报「目录日期与 date 不一致」，RSS 里的先后
 * 顺序也会和读者理解的「同一篇」矛盾。
 *
 * 读的是文件里的原始字面量（`rawScalarValue`），而不是 `gray-matter` 解析后的
 * `Date`：原文写的是 `+08:00`，重新序列化会被转成 UTC，时间点没变但人读起来变了。
 */
function inheritedArticleDate(
  existingLocales: readonly LocaleCode[],
  partDir: string,
): string | null {
  for (const locale of existingLocales) {
    const file = join(partDir, locale, 'index.md')
    if (!existsSync(file)) continue
    const literal = rawScalarValue(readFileSync(file, 'utf-8'), 'date')
    if (literal) return literal
  }
  return null
}

/**
 * 创建文章。
 *
 * 目录结构严格遵循仓库约定：`docs/<YYYYMM>/<DDNN>/<lang>/index.md`。
 */
export function createPost(options: CreatePostOptions): CreatePostResult {
  const now = options.now ?? new Date()
  const title = options.title?.trim() ?? ''
  const docsDir = options.docsDir ?? DOCS_DIR

  const { month, daySeq, sequence, isNewArticleDir } = resolveArticleDir(options, docsDir)

  // 必须在建目录之前取：写入之后就分不清「本来就有」和「刚建的」了
  const existingLocales = articleDirLocales(month, daySeq, docsDir)

  const articleDir = `${month}/${daySeq}`
  const languageDir = `${articleDir}/${options.locale}`
  const filePath = `${languageDir}/index.md`
  const articleDirPath = join(docsDir, month, daySeq)
  const languageDirPath = join(articleDirPath, options.locale)
  const absolutePath = join(languageDirPath, 'index.md')

  if (existsSync(absolutePath)) {
    throw new Error(`目标文件已存在：${filePath}`)
  }

  const slug = resolveSlug(options.slug, title)
  const date =
    inheritedArticleDate(existingLocales, articleDirPath) ?? formatZonedIso(now, SITE_TIME_ZONE)
  const data = buildFrontmatterData({
    title,
    slug,
    date,
    ...(options.tags ? { tags: options.tags } : {}),
    ...(options.description ? { description: options.description } : {}),
    ...(options.draft !== undefined ? { draft: options.draft } : {}),
    ...(options.outline !== undefined ? { outline: options.outline } : {}),
  })

  const content = stringifyFrontmatter(data, initialBody())

  if (!options.dryRun) {
    mkdirSync(languageDirPath, { recursive: true })
    writeFileSync(absolutePath, content, 'utf-8')
  }

  return {
    locale: options.locale,
    filePath,
    absolutePath,
    articleDir,
    languageDir,
    month,
    daySeq,
    sequence,
    slug,
    // 空 slug 在构建期会回退成 `untitled`，这里按同一口径展示，避免打印出坏路径
    url: articleUrlPath(options.locale, month, daySeq, slug === '' ? 'untitled' : slug),
    content,
    written: !options.dryRun,
    existingLocales,
    isNewArticleDir,
  }
}
