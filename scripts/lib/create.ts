/**
 * 新建文章：分配「当日序号」、生成 slug、拼出完整 frontmatter。
 *
 * 序号规则（用户要求「默认从 01 开始往后延 02、03」）：
 * - 扫**目录名**而不是 frontmatter 来决定下一个号，因为目录才是序号的载体；
 * - 已占用号里取最大值 +1，但中间出现空洞时**优先补空洞**（`01`、`03` 存在 → 用 `02`），
 *   这样删错重发不会留下永久空洞；
 * - 超过 `99` 直接报错，而不是悄悄变成三位（那会破坏 `NN` 的定长约定）。
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { FRONTMATTER_FIELDS } from '../../.vitepress/data/frontmatter'
import type { LocaleCode } from '../../.vitepress/types'
import { formatZonedIso } from './dates'
import { stringifyFrontmatter } from './frontmatter'
import { usedSequences } from './posts'
import { DOCS_DIR, POST_SECTION, SITE_TIME_ZONE } from './site'

/** 序号上限：`NN` 是两位，`99` 之后再没有位置。 */
const MAX_SEQUENCE = 99

/** 新建文章的选项。 */
export interface CreatePostOptions {
  locale: LocaleCode
  /** 目录日期的年。 */
  year: string
  /** 目录日期的月。 */
  month: string
  /** 目录日期的日。 */
  day: string
  /** 标题；留空则用占位标题。 */
  title?: string
  /** 目录名（slug）；留空则由标题推导。 */
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
  /** 只计算不落盘（用于测试与 `--dry-run`）。 */
  dryRun?: boolean
}

/** 新建结果。 */
export interface CreatePostResult {
  /** 相对 `docs/` 的源文件路径。 */
  filePath: string
  /** 绝对路径。 */
  absolutePath: string
  /** 分配的序号。 */
  sequence: string
  /** 实际使用的 slug。 */
  slug: string
  /** 写入的文件内容。 */
  content: string
  /** 是否真的写了盘。 */
  written: boolean
}

/**
 * 由标题推导目录名。
 *
 * 规则来自 `WRITING.md` 的「目录名规则」：可以用中文、不要有空格、不要用方括号。
 * 英文标题按 GitHub 习惯转 kebab-case；中文标题**保留原字**（本站 URL 支持，
 * 且比强行拼音更好读），只去掉标点。
 *
 * 标点必须**同时**处理半角与全角：中文输入法打出来的是 `，`、`！`、`（）`，
 * 只过滤 ASCII 标点会把它们原样留在目录名里（实测 `slugify('你好，世界！')`
 * 曾返回 `你好，世界！`），URL 里就会出现一串 `%EF%BC%8C`。
 */
export function slugify(title: string): string {
  const cleaned = title
    .trim()
    // 半角标点与路径不安全字符：换成空格，让 `Hello, World` → `hello-world`
    .replace(/[\\/:*?"<>|[\]#%&{}$!'`^~+=@,;.]/g, ' ')
    /*
     * 全角 / 中日韩标点：**直接删掉**而不是换成空格。
     * 中文没有词间空格，`你好，世界！` 用空格替换会得到 `你好-世界`，
     * 多出来的连字符既不好看也不是中文书写的习惯；删掉才是 `你好世界`。
     */
    .replace(/[\u3000-\u303f\uff00-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65]/g, '')
    // 各种连字符 / 破折号 / 引号 / 省略号 / 间隔号
    .replace(/[\u2010-\u2015\u2018\u2019\u201c\u201d\u2026\u00b7]/g, '')
    // 空白（含制表符与残留的多余空格）统一成单个连字符
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()

  return cleaned
}

/**
 * 分配当日序号。
 *
 * @param used 当天已存在的目录名（含非数字目录，会被忽略）。
 */
export function nextSequence(used: ReadonlySet<string>): string {
  const numbers = [...used]
    .filter((name) => /^\d{2}$/.test(name))
    .map((name) => Number(name))
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
 */
export function buildFrontmatterData(options: {
  title: string
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
 * 创建文章。
 *
 * 目录结构严格遵循仓库约定：`docs/<lang>/posts/YYYY/MM/DD/NN/<slug>/index.md`。
 */
export function createPost(options: CreatePostOptions): CreatePostResult {
  const now = options.now ?? new Date()
  const title = options.title?.trim() || '未命名文章'

  const dir = join(DOCS_DIR, options.locale, POST_SECTION, options.year, options.month, options.day)

  const used = usedSequences(options.locale, {
    year: options.year,
    month: options.month,
    day: options.day,
  })

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

  const slug = (options.slug?.trim() || slugify(title) || 'untitled').replace(/^\/+|\/+$/g, '')
  const articleDir = join(dir, sequence, slug)
  const absolutePath = join(articleDir, 'index.md')
  const filePath = [
    options.locale,
    POST_SECTION,
    options.year,
    options.month,
    options.day,
    sequence,
    slug,
    'index.md',
  ].join('/')

  if (existsSync(absolutePath)) {
    throw new Error(`目标文件已存在：${filePath}`)
  }

  const data = buildFrontmatterData({
    title,
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

  return { filePath, absolutePath, sequence, slug, content, written: !options.dryRun }
}
