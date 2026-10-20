/**
 * RSS 生成（仅构建期，由 `buildEnd` 调用）。
 *
 * 与 Hugo 内嵌模板的差异（也是旧站踩过的坑）：
 * 1. `<description>` 只放**纯文本**摘要——把 HTML 转义后塞进 description，
 *    不渲染 HTML 的阅读器会原样显示 `<p>…`；
 * 2. 额外输出 `<content:encoded>` 放**全文 HTML**，现代阅读器优先读它。
 *
 * 每种语言一个订阅源：`/index.xml`、`/en/index.xml`。
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { LOCALES, SITE } from '../data/site'
import type { LocaleCode, PostSummary } from '../types'
import { readDocs, readPosts } from './content'
import { formatRfc822 } from './format'
import { renderMarkdown } from './markdown'

/**
 * 站点根地址：优先用构建环境变量 `VP_SITE_URL`。
 *
 * 这样部署到 GitHub Pages 项目站点（或临时预览域名）时，
 * RSS 里的绝对链接不会仍然指向正式域名。
 */
const SITE_URL = (process.env.VP_SITE_URL ?? SITE.url).replace(/\/$/, '')

/** XML 文本转义（属性与文本共用，转义范围取并集最省心）。 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** 站点路径 → 源文件路径：`/posts/a/` → `posts/a/index.md`。 */
function toSourcePath(url: string): string {
  return `${url.replace(/^\//, '')}index.md`
}

/** 语言首页地址（带结尾斜杠）。 */
function homeUrl(locale: LocaleCode): string {
  return locale === 'root' ? `${SITE_URL}/` : `${SITE_URL}/en/`
}

/**
 * 订阅源里某篇文章的全文 HTML。
 * 相对链接补成绝对地址，避免阅读器按 feed 地址解析导致图片/链接失效。
 */
function articleHtml(post: PostSummary, docs: Map<string, string>): string {
  const source = docs.get(toSourcePath(post.url))
  if (!source) return ''

  const absolute = `${SITE_URL}${post.url}`
  return renderMarkdown(source).replace(/(src|href)="\/(?!\/)/g, `$1="${absolute}`)
}

/** 生成一个语言的 RSS XML。 */
function buildFeed(locale: LocaleCode, posts: PostSummary[], docs: Map<string, string>): string {
  const meta = LOCALES[locale]
  const home = homeUrl(locale)
  const feedUrl = `${home}index.xml`
  const lastBuild = posts[0] ? formatRfc822(new Date(posts[0].date), SITE.timeZone) : ''

  const items = posts
    .map((post) => {
      const link = `${SITE_URL}${post.url}`
      return [
        '    <item>',
        `      <title>${escapeXml(post.title)}</title>`,
        `      <link>${escapeXml(link)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
        `      <pubDate>${formatRfc822(new Date(post.date), SITE.timeZone)}</pubDate>`,
        `      <description>${escapeXml(post.summary)}</description>`,
        `      <content:encoded>${escapeXml(articleHtml(post, docs))}</content:encoded>`,
        ...post.tags.map((tag) => `      <category>${escapeXml(tag.label)}</category>`),
        '    </item>',
      ].join('\n')
    })
    .join('\n')

  return `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${escapeXml(meta.title)}</title>
    <link>${escapeXml(home)}</link>
    <description>${escapeXml(meta.description)}</description>
    <language>${meta.lang}</language>
    <generator>VitePress</generator>${
      lastBuild ? `\n    <lastBuildDate>${lastBuild}</lastBuildDate>` : ''
    }
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`
}

/** 为每种语言写出订阅源。`outDir` 是构建产物目录。 */
export function writeFeeds(outDir: string): void {
  // 正文只读一次，避免每篇文章都全量扫描
  const docs = new Map(readDocs().map((doc) => [doc.filePath, doc.body]))

  for (const locale of Object.keys(LOCALES) as LocaleCode[]) {
    const posts = readPosts(locale)
    const target = locale === 'root' ? join(outDir, 'index.xml') : join(outDir, 'en', 'index.xml')

    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, buildFeed(locale, posts, docs), 'utf-8')
  }
}
