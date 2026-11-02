/**
 * 内容读取与解析（仅构建期运行）。
 *
 * 这是「文章」概念的**唯一入口**：列表页、标签页、RSS、统计卡片都从这里取数据，
 * 避免多处各自解析 Markdown 导致口径不一致。
 *
 * ## 文章在哪
 *
 * ```text
 * docs/<YYYYMM>/<DDNN>/<locale>/index.md
 * ```
 *
 * 目录里只有数字与语言：`YYYYMM` 是年月，`DDNN` 是「日 + 当日序号」，
 * `zh-cn` / `en` 是文章的语言版本（缺一个 = 该语言没有这篇）。
 * 标题与 URL 的标题段由 frontmatter 的 `title` / `slug` 决定，
 * 实际 URL（`/zh-cn/202610/1901/<slug>/`）由 `config.ts` 的 `rewrites`
 * 映射出来——因此 **`url` 不能用源文件路径直接换算**，必须走
 * `articleRoutePath()`（规则见 `support/article-path.ts`）。
 *
 * 非文章页面在 `docs/site/<locale>/**`，去掉 `site/` 前缀就是 URL。
 *
 * ## 草稿
 *
 * 草稿只由 frontmatter 的 `draft: true` 决定，并且**完全不构建**：
 * `config.ts` 把它们的源路径算进 `srcExclude`（页面不生成、不进 sitemap/RSS），
 * 本文件也不把它们算进文章列表与页面索引，`support/media/vite.ts` 则跳过
 * 草稿里引用的图片。草稿的源路径由 `draftSourcePaths()` 提供给上面两处。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

import matter from 'gray-matter'

import { DEFAULT_LOCALE, LOCALES } from '../data/site'
import { TAG_LABELS, TAG_SLUGS } from '../data/taxonomy'
import type { LocaleCode, PostSummary, TagRef } from '../types'
import { articleRoutePath, isArticlePath, localeOfDocPath, siteRoutePath } from './article-path'
import {
  countWords,
  firstParagraph,
  formatDate,
  formatIsoDate,
  formatShortDate,
  formatUpdatedDate,
  formatYear,
  isDuplicateOpening,
  isMeaningfulUpdate,
  parseDate,
  plainText,
  readingMinutes,
  truncate,
} from './format'
import { slugOf } from './slug'
import { pairKeyOf } from './translation'
import { toPageUrl } from './urls'

/** 内容根目录。优先取 VitePress 已解析的 `srcDir`，避免依赖启动目录。 */
export const DOCS_DIR =
  (globalThis as { VITEPRESS_CONFIG?: { srcDir?: string } }).VITEPRESS_CONFIG?.srcDir ??
  resolve(process.cwd(), 'docs')

/**
 * 不作为内容页统计的目录。
 *
 * `shared` 只放跨语言共用的资源，不是页面：放进去的 `.md` 会变成没有语言
 * 前缀的孤儿页面，所以内容扫描与 `config.ts` 的 `srcExclude` 都不认它。
 */
const IGNORED_DIRS = new Set(['.vitepress', 'public', 'node_modules', 'shared'])

/** 一份 Markdown 文档的原始信息。 */
export interface RawDoc {
  /** 相对 `docs/` 的路径，统一用 `/` 分隔，含语言（`202610/1901/zh-cn/index.md`）。 */
  filePath: string
  /**
   * 这份文档真正的 route 相对路径（`rewrites` 的目标，带 `.md`）。
   *
   * 文章是 `<locale>/<YYYYMM>/<DDNN>/<slug>/index.md`；站点页面去掉
   * `site/` 前缀；RSS、canonical、页面的 `relativePath` 都以它为准。
   */
  routePath: string
  /** 站点内路径（已 URL 编码），含语言前缀，如 `/zh-cn/pages/tags/随笔/`。 */
  url: string
  /** 所属语言。 */
  locale: LocaleCode
  /** frontmatter。 */
  data: Record<string, unknown>
  /** 正文（不含 frontmatter）。 */
  body: string
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

/**
 * 一份文档的 route 路径。
 *
 * 文章用「语言 + 日期目录 + slug」拼出带标题段的地址；站点页面直接去掉
 * `site/` 前缀（`site/zh-cn/pages/about/index.md` → `zh-cn/pages/about/index.md`）。
 */
export function routePathOf(filePath: string, data: Record<string, unknown>): string {
  return articleRoutePath(filePath, slugOf(data)) ?? siteRoutePath(filePath) ?? filePath
}

/** 读取单份 Markdown，解析 frontmatter。 */
export function readDoc(filePath: string): RawDoc {
  const raw = readFileSync(join(DOCS_DIR, filePath), 'utf-8')
  const { data, content } = matter(raw)
  const routePath = routePathOf(filePath, data as Record<string, unknown>)

  return {
    filePath,
    routePath,
    url: toPageUrl(routePath),
    locale: localeOfDocPath(filePath),
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

/** 是否为一篇文章：路径符合 `<locale>/<YYYYMM>/<DDNN>/index.md`，且声明了日期。 */
export function isPost(doc: RawDoc): boolean {
  return isArticlePath(doc.filePath) && parseDate(doc.data.date) !== null
}

/**
 * `config.ts` 的 `rewrites` 映射：文章源路径 → 带 slug 的 route 路径。
 *
 * VitePress 用这张表决定「页面最终挂在哪个 URL」。除了文章，其它页面
 * 原样返回（见 `config.ts` 的 `rewrites` 函数）。
 */
export function articleRewrites(): Record<string, string> {
  const rewrites: Record<string, string> = {}
  for (const doc of readDocs()) {
    if (!isArticlePath(doc.filePath)) continue
    rewrites[doc.filePath] = doc.routePath
  }
  return rewrites
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
 * `随笔` + `zh-cn` → `/zh-cn/pages/tags/%E9%9A%8F%E7%AC%94/`。
 *
 * `slug` 存**原文**（`随笔`），`url` 存**编码后**的地址。全站只有这一处做这个转换，
 * 与 `toPageUrl()` 的编码规则一致，因此标签页的 canonical 与 sitemap 不会出现两种形式。
 */
export function makeTagRef(raw: string, locale: LocaleCode = DEFAULT_LOCALE): TagRef {
  const slug = tagSlugOf(raw)
  return {
    label: tagLabelOf(raw),
    slug,
    url: encodeURI(`/${locale}/pages/tags/${slug}/`),
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

  /*
   * 导语：作者显式写的 `description`，但**与正文首段重复时不显示**。
   *
   * 本站现有文章的 description 常常就是正文第一段（例如《你好，世界》），
   * 直接贴到标题下会让同一句话出现两次；比较时先去掉标点/空白
   * （description 用 `「」`、正文用 `“”`），否则永远判不相等。
   */
  const explicitLead = explicitSummary ? plainText(explicitSummary) : ''
  const opening = firstParagraph(doc.body)
  const lead = explicitLead && !isDuplicateOpening(explicitLead, opening) ? explicitLead : null

  /*
   * 更新日期：只有「更新日晚于发布日」才计算展示值。
   * `updated` 写错（早于发布日）或与发布日同一天时，三个字段全部为 null ——
   * 显示层不需要再判断一次。
   */
  const publishedYear = formatYear(date, meta.timeZone)
  const updatedAt = parseDate(doc.data.updated)
  const hasUpdate = isMeaningfulUpdate(date, updatedAt, meta.timeZone)

  return {
    url: doc.url,
    title:
      typeof doc.data.title === 'string' && doc.data.title.trim() ? doc.data.title : doc.filePath,
    summary: truncate(plainText(summarySource), 160),
    date: date.toISOString(),
    isoDate: formatIsoDate(date, meta.timeZone),
    dateText: formatDate(date, doc.locale, meta.timeZone),
    dateShort: formatShortDate(date, meta.timeZone),
    year: publishedYear,
    tags,
    wordCount: countWords(doc.body),
    readingMinutes: readingMinutes(doc.body),
    lead: lead ? truncate(lead, 160) : null,
    updated: hasUpdate ? updatedAt.toISOString() : null,
    updatedIso: hasUpdate ? formatIsoDate(updatedAt, meta.timeZone) : null,
    updatedText: hasUpdate ? formatUpdatedDate(updatedAt, meta.timeZone, publishedYear) : null,
    locale: doc.locale,
    pairKey: pairKeyOf(doc.filePath),
  }
}

/**
 * 读取已发布文章，按时间倒序。
 *
 * 草稿（`draft: true`）在**构建期就被整体排除**（`config.ts` 的 `srcExclude`），
 * 这里再过滤一次是为了不依赖构建配置：`pnpm posts` 等脚本也直接读内容，
 * 它们拿到的同样应该是「读者能看到的文章」。
 */
function collectPosts(locale?: LocaleCode): PostSummary[] {
  return readDocs()
    .filter(isPost)
    .filter((doc) => doc.data.draft !== true)
    .map(toPostSummary)
    .filter((post) => (locale ? post.locale === locale : true))
    .toSorted((a, b) => +new Date(b.date) - +new Date(a.date))
}

/** 全部已发布文章，按时间倒序。草稿不进入任何列表。 */
export function readPosts(locale?: LocaleCode): PostSummary[] {
  return collectPosts(locale)
}

/**
 * 草稿的源文件路径（相对 `docs/`）。
 *
 * 只给构建配置用：`config.ts` 把它们算进 `srcExclude`，于是草稿**完全不构建**
 * （不生成页面、不进 sitemap/RSS/列表/搜索）；`support/media/vite.ts` 也据此
 * 跳过草稿里引用的图片，避免为不存在的页面发射产物。
 */
export function draftSourcePaths(): string[] {
  return readDocs()
    .filter((doc) => doc.data.draft === true)
    .map((doc) => doc.filePath)
}

/** 全部内容页路径（供语言切换判断「是否存在对应翻译」）。草稿不算页面。 */
export function readPageUrls(): string[] {
  return readDocs()
    .filter((doc) => doc.data.draft !== true)
    .map((doc) => doc.url)
}
