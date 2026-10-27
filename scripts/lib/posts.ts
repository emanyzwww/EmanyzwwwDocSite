/**
 * 文章路径解析：`docs/<lang>/<YYYYMM>/<DDNN>/index.md`。
 *
 * 这是命令行侧对「一篇文章在哪」的唯一理解，`new` / `posts` / `check` / `fix`
 * 全部走这里。判定不自己写正则，而是复用 `.vitepress/support/article-path.ts`
 * 的 `parseArticlePath` —— 构建期的 `rewrites`、列表页、RSS 也用它，规则必须同源。
 *
 * 重构后的判定是**严格**的：只有 `<lang>/<YYYYMM>/<DDNN>/index.md` 才是文章；
 * `docs/<lang>/pages/**` 是静态/功能页，`docs/<lang>/_drafts/**` 是草稿，都不算。
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import matter from 'gray-matter'

import { LOCALE_CODES } from '../../.vitepress/data/site'
import {
  articleUrlPath,
  isArticlePath,
  parseArticlePath,
} from '../../.vitepress/support/article-path'
import { parseDate } from '../../.vitepress/support/format'
import { slugOf } from '../../.vitepress/support/slug'
import type { LocaleCode } from '../../.vitepress/types'
import { collectMarkdownFiles, DOCS_DIR, isDirectory, localeDir, relativePathToUrl } from './site'

/** 一篇文章的目录身份：`<YYYYMM>/<DDNN>/index.md`。 */
export interface PostPathInfo {
  /** 相对 `docs/` 的源文件路径，`/` 分隔。 */
  filePath: string
  /** 绝对路径。 */
  absolutePath: string
  /** 所属语言。 */
  locale: LocaleCode
  /**
   * 站点路径（**未编码**，供终端展示）：`/zh-cn/202610/1901/你好，世界/`。
   * 不符合文章约定时退回源文件路径的通用换算，至少能看出文件在哪。
   */
  url: string
  /** 年月目录，如 `202610`。 */
  month: string
  /** 日 + 序号目录，如 `1901`。 */
  daySeq: string
  /** 两位「日」，如 `19`。 */
  day: string
  /** 两位「当日序号」，如 `01`。 */
  sequence: string
  /** 跨语言配对键：`<YYYYMM>/<DDNN>`，如 `202610/1901`。 */
  key: string
  /** 目录日期 `YYYYMMDD`（如 `20261019`），用于和 frontmatter 的 `date` 对比。 */
  dateKey: string
  /** URL 段落（frontmatter 的 `slug`，缺失时由 `title` 推导）。 */
  slug: string
  /** 是否符合 `<YYYYMM>/<DDNN>/index.md` 约定。 */
  compliant: boolean
  /** 不符合约定时的原因，便于 `check` 给出可操作的提示。 */
  deviation?: string
}

/** 一份已解析的文章（含 frontmatter 与正文）。 */
export interface PostFile {
  path: PostPathInfo
  /** frontmatter 原始键值。 */
  data: Record<string, unknown>
  /** 正文（不含 frontmatter）。 */
  body: string
  /** 整个文件的原始文本。 */
  raw: string
}

/** 一篇「看起来想当文章、却不在文章目录」的文件。 */
export interface MisplacedDatedFile {
  /** 相对 `docs/` 的路径，`/` 分隔。 */
  filePath: string
}

/** 不是文章区、也不需要报「放错位置」的分区。 */
const NON_ARTICLE_SECTIONS = new Set(['pages', '_drafts'])

/** 文件路径的第一段是否是语言代码；不是时回退到调用方给的语言。 */
function localeOfPath(filePath: string, fallback: LocaleCode): LocaleCode {
  const first = filePath.split('/')[0]
  return (LOCALE_CODES as readonly string[]).includes(first) ? (first as LocaleCode) : fallback
}

/**
 * 解析文章路径。
 *
 * 不符合 `<YYYYMM>/<DDNN>/index.md` 时**不抛错**，而是标记 `compliant: false`
 * 并给出原因：`check` 要拿它报「目录不符合约定」，而目录里可能还躺着迁移前的
 * 旧路径文件——报错会中断整个检查，反而看不到完整清单。
 *
 * `data` 用来取 slug：文章 URL 由「目录 + slug」拼成，光有路径算不出来。
 * 不传 `data` 时 slug 走 `slugOf({})`（即 `untitled`），只有展示用途。
 */
export function parsePostPath(
  filePath: string,
  locale: LocaleCode,
  data: Record<string, unknown> = {},
  docsDir: string = DOCS_DIR,
): PostPathInfo {
  const slug = slugOf(data)
  const parts = parseArticlePath(filePath)

  const base: PostPathInfo = {
    filePath,
    absolutePath: join(docsDir, filePath),
    locale: localeOfPath(filePath, locale),
    url: relativePathToUrl(filePath),
    month: '',
    daySeq: '',
    day: '',
    sequence: '',
    key: '',
    dateKey: '',
    slug,
    compliant: false,
  }

  if (!parts) {
    return {
      ...base,
      deviation: `路径为 ${filePath}，应为 <lang>/<YYYYMM>/<DDNN>/index.md（如 zh-cn/202610/1901/index.md）`,
    }
  }

  return {
    ...base,
    locale: parts.locale,
    url: articleUrlPath(parts.locale, parts.month, parts.daySeq, slug),
    month: parts.month,
    daySeq: parts.daySeq,
    day: parts.day,
    sequence: parts.sequence,
    key: parts.key,
    dateKey: parts.dateKey,
    compliant: true,
  }
}

/** 读取并解析一份文章。 */
export function readPostFile(
  filePath: string,
  locale: LocaleCode,
  docsDir: string = DOCS_DIR,
): PostFile {
  const raw = readFileSync(join(docsDir, filePath), 'utf-8')
  const { data, content } = matter(raw)
  const record = data as Record<string, unknown>

  return {
    path: parsePostPath(filePath, locale, record, docsDir),
    data: record,
    body: content,
    raw,
  }
}

/**
 * 收集某语言（或全部语言）下的文章文件。
 *
 * 只认 `<lang>/<YYYYMM>/<DDNN>/index.md` —— 与构建期 `support/content.ts` 的
 * `isPost()` 口径一致。`includeUndated: true` 时也返回缺 `date` 的文件，
 * 仅供 `check` 报告「文章目录里没有 date」，正常列举不该带上它。
 */
export function collectPostFiles(
  locale?: LocaleCode,
  options: { includeUndated?: boolean; docsDir?: string } = {},
): PostFile[] {
  const locales = locale ? [locale] : LOCALE_CODES
  const docsDir = options.docsDir ?? DOCS_DIR

  const files: PostFile[] = []
  for (const code of locales) {
    for (const filePath of collectMarkdownFiles(join(docsDir, code), docsDir)) {
      if (!isArticlePath(filePath)) continue

      const post = readPostFile(filePath, code, docsDir)
      if (!options.includeUndated && parseDate(post.data.date) === null) continue
      files.push(post)
    }
  }

  return files
}

/**
 * 扫描「有 `date`、却不在文章目录」的 Markdown。
 *
 * 新布局下文章位置是严格判定的：带日期但放在别处（语言根目录、旧的
 * `YYYY/MM/DD/NN/` 结构、或文章目录里忘了叫 `index.md`）的文件会被当作普通页面
 * 静默渲染，不会进文章列表。`check` 用这份清单提示，否则「文章没出现」很难排查。
 *
 * `pages/` 与 `_drafts/` 是有意为之的非文章区，跳过。
 */
export function collectMisplacedDatedFiles(
  locale?: LocaleCode,
  options: { docsDir?: string } = {},
): MisplacedDatedFile[] {
  const locales = locale ? [locale] : LOCALE_CODES
  const docsDir = options.docsDir ?? DOCS_DIR

  const found: MisplacedDatedFile[] = []
  for (const code of locales) {
    for (const filePath of collectMarkdownFiles(join(docsDir, code), docsDir)) {
      if (isArticlePath(filePath)) continue
      // 相对语言目录的第一段：`pages/`、`_drafts/` 不参与文章判定
      if (NON_ARTICLE_SECTIONS.has(filePath.split('/')[1] ?? '')) continue

      const { data } = matter(readFileSync(join(docsDir, filePath), 'utf-8'))
      if (parseDate((data as Record<string, unknown>).date) === null) continue
      found.push({ filePath })
    }
  }

  return found
}

/** 文章的实际日期（frontmatter），无法解析时返回 null。 */
export function postDate(post: PostFile): Date | null {
  return parseDate(post.data.date)
}

/**
 * 该语言某天已占用的序号（`01`、`02`…）。
 *
 * 扫的是**目录名**而不是全部文章的 frontmatter：序号是目录约定，
 * 空目录 / 刚建好还没写 `date` 的目录同样占着号，按 frontmatter 算会把
 * 已经存在的目录覆盖掉。目录名形如 `<day><NN>`（`1901`），返回后两位。
 */
export function usedSequences(
  locale: LocaleCode,
  dateParts: { month: string; day: string },
  docsDir: string = DOCS_DIR,
): Set<string> {
  const monthDir = join(docsDir, locale, dateParts.month)
  if (!isDirectory(monthDir)) return new Set()

  // 只认当天的目录：`2001` 属于 20 日，不能干扰 19 日的序号分配
  const dayPattern = new RegExp(`^${dateParts.day}\\d{2}$`)
  return new Set(
    readdirSync(monthDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && dayPattern.test(entry.name))
      .map((entry) => entry.name.slice(2)),
  )
}

/** 列出某语言某月已有的文章目录名（`1901`、`2601`），用于提示「这个月有几篇」。 */
export function existingMonthDirs(locale: LocaleCode, month: string): string[] {
  const monthDir = join(localeDir(locale), month)
  if (!isDirectory(monthDir)) return []

  return readdirSync(monthDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted()
}
