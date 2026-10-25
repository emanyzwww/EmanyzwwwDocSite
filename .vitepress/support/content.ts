/**
 * 内容读取与解析（仅构建期运行）。
 *
 * 这是「文章」概念的**唯一入口**：列表页、标签页、RSS、统计卡片都从这里取数据，
 * 避免多处各自解析 Markdown 导致口径不一致。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

import matter from 'gray-matter'

import { asLocale, DEFAULT_LOCALE, LOCALE_CODES, LOCALES } from '../data/site'
import { TAG_LABELS, TAG_SLUGS } from '../data/taxonomy'
import type { LocaleCode, PostSummary, TagRef } from '../types'
import {
  countWords,
  firstParagraph,
  formatDate,
  formatIsoDate,
  formatShortDate,
  formatYear,
  parseDate,
  plainText,
  truncate,
} from './format'
import { translationKeyOf } from './translation'
import { toPageUrl } from './urls'

/** 内容根目录。优先取 VitePress 已解析的 `srcDir`，避免依赖启动目录。 */
export const DOCS_DIR =
  (globalThis as { VITEPRESS_CONFIG?: { srcDir?: string } }).VITEPRESS_CONFIG?.srcDir ??
  resolve(process.cwd(), 'docs')

/** 文章所在的分区名。与 Hugo 的 `Section` 语义一致。 */
const POST_SECTION = 'posts'

/** 不作为内容页统计的目录。 */
const IGNORED_DIRS = new Set(['.vitepress', 'public', 'node_modules'])

/** 一份 Markdown 文档的原始信息。 */
export interface RawDoc {
  /** 相对 `docs/` 的路径，统一用 `/` 分隔，含语言前缀（`zh-cn/posts/x/index.md`）。 */
  filePath: string
  /** 站点内路径（已 URL 编码），含语言前缀，如 `/zh-cn/tags/随笔/` → `/zh-cn/tags/%E9%9A%8F%E7%AC%94/`。 */
  url: string
  /** 所属语言。 */
  locale: LocaleCode
  /** frontmatter。 */
  data: Record<string, unknown>
  /** 正文（不含 frontmatter）。 */
  body: string
}

/** 判断文件属于哪种语言：第一段目录名就是语言。 */
function toLocale(filePath: string): LocaleCode {
  return asLocale(filePath.split('/')[0])
}

/** 去掉语言前缀：`zh-cn/posts/x/index.md` → `posts/x/index.md`。 */
export function stripLocalePrefix(filePath: string): string {
  const first = filePath.split('/')[0]
  return LOCALE_CODES.includes(first as LocaleCode) ? filePath.slice(first.length + 1) : filePath
}

/** 递归收集 `docs/` 下所有 Markdown 文件（相对路径，`/` 分隔）。 */
function collectMarkdown(dir = DOCS_DIR, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue

    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      collectMarkdown(full, acc)
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      acc.push(relative(DOCS_DIR, full).split(sep).join('/'))
    }
  }
  return acc
}

/** 读取单份 Markdown，解析 frontmatter。 */
export function readDoc(filePath: string): RawDoc {
  const raw = readFileSync(join(DOCS_DIR, filePath), 'utf-8')
  const { data, content } = matter(raw)

  return {
    filePath,
    url: toPageUrl(filePath),
    locale: toLocale(filePath),
    data: data as Record<string, unknown>,
    body: content,
  }
}

/**
 * 全量文档缓存。
 *
 * `readPosts()` 会被 `transformPageData`（每个标签页、每个分页页各一次）、
 * 两个 `*.paths.ts`、`posts.data.ts`、RSS 反复调用。不加缓存时，每次都要
 * 递归遍历目录 + `readFileSync` + `gray-matter` 解析，文章一多就是 O(n²) 的磁盘 IO。
 *
 * 缓存键是「全部 .md 的相对路径 + mtime」，因此：
 * - 构建期只扫一次；
 * - dev 下改了文件，路径或 mtime 变化会自动失效，不需要手动重启。
 */
let docsCache: { key: string; docs: RawDoc[] } | null = null

/** 缓存键：文件清单 + 各自 mtime，任一变化即失效。 */
function docsCacheKey(files: string[]): string {
  return files
    .map((file) => {
      const stat = statSync(join(DOCS_DIR, file), { throwIfNoEntry: false })
      return `${file}:${stat?.mtimeMs ?? 0}`
    })
    .join('|')
}

/** 读取全部 Markdown（带缓存）。 */
export function readDocs(): RawDoc[] {
  const files = collectMarkdown().toSorted()
  const key = docsCacheKey(files)
  if (docsCache?.key === key) return docsCache.docs

  const docs = files.map(readDoc)
  docsCache = { key, docs }
  return docs
}

/** 清空缓存（仅供测试使用）。 */
export function clearContentCache(): void {
  docsCache = null
}

/** 是否为一篇文章：去掉语言前缀后位于 `posts/` 分区，且声明了日期。 */
export function isPost(doc: RawDoc): boolean {
  return (
    stripLocalePrefix(doc.filePath).startsWith(`${POST_SECTION}/`) &&
    parseDate(doc.data.date) !== null
  )
}

/** 标签展示名：允许在 `data/taxonomy.ts` 里给某个 slug 指定更友好的名字。 */
function tagLabelOf(raw: string): string {
  return TAG_LABELS[raw] ?? raw
}

/** 标签 URL 片段：默认沿用标签原文，保证与旧站 `/tags/随笔/` 兼容。 */
function tagSlugOf(raw: string): string {
  return TAG_SLUGS[raw] ?? raw
}

/**
 * 由原始标签名构造标签引用。
 *
 * 标签页地址带语言前缀，与内容目录一一对应：
 * `随笔` + `zh-cn` → `/zh-cn/tags/%E9%9A%8F%E7%AC%94/`，`Essay` + `en` → `/en/tags/Essay/`。
 *
 * `slug` 存**原文**（`随笔`），`url` 存**编码后**的地址。全站只有这一处做这个转换，
 * 与 `toPageUrl()` 的编码规则一致，因此标签页的 canonical 与 sitemap 不会出现两种形式。
 */
export function makeTagRef(raw: string, locale: LocaleCode = DEFAULT_LOCALE): TagRef {
  const slug = tagSlugOf(raw)
  return {
    label: tagLabelOf(raw),
    slug,
    url: encodeURI(`/${locale}/tags/${slug}/`),
  }
}

/**
 * 标签 slug → 标签引用（构建期建一次，供 `transformPageData` 查）。
 *
 * 之前每个标签页都 `readPosts(locale).flatMap(...).find(...)` 遍历一遍，
 * 标签一多就是 O(n²)。这里改成一次建表、O(1) 查。
 */
export function buildTagIndex(locale: LocaleCode): Map<string, TagRef> {
  const index = new Map<string, TagRef>()
  for (const post of readPosts(locale)) {
    for (const tag of post.tags) index.set(tag.slug, tag)
  }
  return index
}

/** 把一份文档转成文章摘要。 */
export function toPostSummary(doc: RawDoc): PostSummary {
  const date = parseDate(doc.data.date)
  if (!date) throw new Error(`文章缺少有效日期：${doc.filePath}`)

  const meta = LOCALES[doc.locale]
  const rawTags = Array.isArray(doc.data.tags) ? (doc.data.tags as unknown[]) : []
  const tags = rawTags
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => makeTagRef(tag, doc.locale))

  const explicitSummary =
    typeof doc.data.description === 'string' && doc.data.description.trim()
      ? doc.data.description
      : typeof doc.data.summary === 'string' && doc.data.summary.trim()
        ? doc.data.summary
        : ''

  const summarySource = explicitSummary || firstParagraph(doc.body)

  return {
    url: doc.url,
    title:
      typeof doc.data.title === 'string' && doc.data.title.trim() ? doc.data.title : doc.filePath,
    summary: truncate(plainText(summarySource), 160),
    date: date.toISOString(),
    isoDate: formatIsoDate(date, meta.timeZone),
    dateText: formatDate(date, doc.locale, meta.timeZone),
    dateShort: formatShortDate(date, meta.timeZone),
    year: formatYear(date, meta.timeZone),
    tags,
    wordCount: countWords(doc.body),
    draft: doc.data.draft === true,
    locale: doc.locale,
    filePath: doc.filePath,
    translationKey: translationKeyOf(doc.data, doc.filePath),
  }
}

/**
 * 读取全部已发布文章，按时间倒序。
 * 草稿（`draft: true`）不进入任何列表。
 */
export function readPosts(locale?: LocaleCode): PostSummary[] {
  return readDocs()
    .filter(isPost)
    .map(toPostSummary)
    .filter((post) => !post.draft)
    .filter((post) => (locale ? post.locale === locale : true))
    .toSorted((a, b) => +new Date(b.date) - +new Date(a.date))
}

/** 全部内容页路径（供语言切换判断「是否存在对应翻译」）。 */
export function readPageUrls(): string[] {
  return readDocs().map((doc) => doc.url)
}
