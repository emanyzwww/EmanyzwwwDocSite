/**
 * 新建文章：分配「当日序号」、决定 slug、拼出完整 frontmatter。
 *
 * 目录布局是唯一形态 `docs/<lang>/<YYYYMM>/<DDNN>/index.md`：
 * 序号规则（用户要求「默认从 01 开始往后延 02、03」）：
 * - 扫**目录名**而不是 frontmatter 来决定下一个号，因为目录才是序号的载体；
 * - 已占用号里取最大值 +1，但中间出现空洞时**优先补空洞**（`01`、`03` 存在 → 用 `02`），
 *   这样删错重发不会留下永久空洞；
 * - 超过 `99` 直接报错，而不是悄悄变成三位（那会破坏 `NN` 的定长约定）。
 *
 * slug 只写进 frontmatter，**不再参与目录名**：标题与 URL 段落解耦后，
 * 改标题/改 URL 不需要移动文件（URL 由 `rewrites` 从目录 + slug 拼出）。
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { FRONTMATTER_FIELDS } from '../../.vitepress/data/frontmatter'
import { articleDirOf, articleUrlPath } from '../../.vitepress/support/article-path'
import { isUsableSlug, slugify } from '../../.vitepress/support/slug'
import type { LocaleCode } from '../../.vitepress/types'
import { formatZonedIso } from './dates'
import { stringifyFrontmatter } from './frontmatter'
import { usedSequences } from './posts'
import { DOCS_DIR, SITE_TIME_ZONE } from './site'

/** 序号上限：`NN` 是两位，`99` 之后再没有位置。 */
const MAX_SEQUENCE = 99

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
  /** 内容根目录，默认仓库 `docs/`；单测用临时目录隔离，避免依赖真实文章。 */
  docsDir?: string
  /** 只计算不落盘（用于测试与 `--dry-run`）。 */
  dryRun?: boolean
}

/** 新建结果。 */
export interface CreatePostResult {
  /** 相对 `docs/` 的源文件路径。 */
  filePath: string
  /** 绝对路径。 */
  absolutePath: string
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

  const candidate = explicit !== '' ? explicit : slugify(title)
  return isUsableSlug(candidate) ? candidate : 'untitled'
}

/**
 * 创建文章。
 *
 * 目录结构严格遵循仓库约定：`docs/<lang>/<YYYYMM>/<DDNN>/index.md`。
 */
export function createPost(options: CreatePostOptions): CreatePostResult {
  const now = options.now ?? new Date()
  const title = options.title?.trim() || '未命名文章'
  const docsDir = options.docsDir ?? DOCS_DIR
  const dateParts = { year: options.year, month: options.month, day: options.day }

  const used = usedSequences(
    options.locale,
    { month: `${dateParts.year}${dateParts.month}`, day: dateParts.day },
    docsDir,
  )

  /*
   * 显式指定的序号必须校验：撞号会造成两篇文章共用 URL 前缀，
   * 静默覆盖或静默跳过都比报错危险。
   */
  const sequence = options.sequence ?? nextSequence(used)
  if (options.sequence !== undefined && used.has(options.sequence)) {
    throw new Error(
      `序号 ${options.sequence} 已被占用：当天已有 ${[...used].toSorted().join('、')}`,
    )
  }

  const { month, daySeq } = articleDirOf(dateParts, sequence)
  const slug = resolveSlug(options.slug, title)
  const articleDir = join(docsDir, options.locale, month, daySeq)
  const filePath = [options.locale, month, daySeq, 'index.md'].join('/')
  const absolutePath = join(articleDir, 'index.md')

  if (existsSync(absolutePath)) {
    throw new Error(`目标文件已存在：${filePath}`)
  }

  const data = buildFrontmatterData({
    title,
    slug,
    date: formatZonedIso(now, SITE_TIME_ZONE),
    ...(options.tags ? { tags: options.tags } : {}),
    ...(options.description ? { description: options.description } : {}),
    ...(options.draft !== undefined ? { draft: options.draft } : {}),
    ...(options.outline !== undefined ? { outline: options.outline } : {}),
  })

  const content = stringifyFrontmatter(data, initialBody())

  if (!options.dryRun) {
    mkdirSync(articleDir, { recursive: true })
    writeFileSync(absolutePath, content, 'utf-8')
  }

  return {
    filePath,
    absolutePath,
    month,
    daySeq,
    sequence,
    slug,
    url: articleUrlPath(options.locale, month, daySeq, slug),
    content,
    written: !options.dryRun,
  }
}
