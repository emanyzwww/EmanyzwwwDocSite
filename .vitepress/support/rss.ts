/**
 * RSS 生成（仅构建期，由 `buildEnd` 调用）。
 *
 * 与 Hugo 内嵌模板的差异（也是旧站踩过的坑）：
 * 1. `<description>` 只放**纯文本**摘要——把 HTML 转义后塞进 description，
 *    不渲染 HTML 的阅读器会原样显示 `<p>…`；
 * 2. 额外输出 `<content:encoded>` 放**全文 HTML**，现代阅读器优先读它。
 *
 * 每种语言一个订阅源：`/zh-cn/index.xml`、`/en/index.xml`。
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { LOCALE_CODES, LOCALES, SITE } from '../data/site'
import type { LocaleCode, PostSummary } from '../types'
import { readPosts } from './content'
import { sanitizeFeedCode } from './feed-code'
import { formatRfc822 } from './format'
import { getRenderedContent } from './rendered'
import { decodePath } from './urls'

/**
 * 站点根地址：优先用构建环境变量 `VP_SITE_URL`。
 *
 * 这样部署到 GitHub Pages 项目站点（或临时预览域名）时，
 * RSS 里的绝对链接不会仍然指向正式域名。
 *
 * **注意它可能已经含部署子路径**（CI 传入的是
 * `https://owner.github.io/<repo>`），所以任何「站内路径 → 绝对地址」
 * 的转换都必须先把路径里的 base 剥掉、再拼这个前缀，
 * 否则会出现 `/<repo>/<repo>/assets/...` 这种重复拼接。
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

/**
 * 文章 URL（route 路径）→ 渲染内容 Map 的 key。
 *
 * 例：`/zh-cn/202610/1901/你好，世界/` → `zh-cn/202610/1901/你好，世界/index.md`。
 *
 * 注意 slug 段来自 `rewrites`，磁盘上并没有这个文件——它只是
 * `transformHtml` 阶段写进 `support/rendered.ts` 的 Map 键。
 * `post.url` 是 `encodeURI` 之后的地址（中文 slug 会变成 `%E4%BD%A0...`），
 * 因此这里必须解码回原文再拼。
 */
function toSourcePath(url: string): string {
  return `${decodePath(url).replace(/^\//, '')}index.md`
}

/** 语言首页地址（带结尾斜杠）。每种语言一个前缀，没有例外。 */
function homeUrl(locale: LocaleCode): string {
  return `${SITE_URL}/${locale}/`
}

/**
 * 订阅源里某篇文章的全文 HTML。
 *
 * 取的是**VitePress 已渲染好的正文**（`transformHtml` 阶段收集，见
 * `support/rendered.ts`），而不是自己再渲染一遍 Markdown。这样做解决了三个问题：
 *
 * 1. **图片地址正确**：网页上的图是 `/assets/media/<sha>-672.webp`（媒体管线产出），
 *    裸 markdown-it 渲染出的却是 `./banner.png` —— 后者部署后不存在，阅读器必裂图。
 * 2. **`{width=100}` 不泄漏**：那是 VitePress 的 attrs 语法，已由它的渲染器消费；
 *    裸 markdown-it 不认识，会把字面量原样留在正文里。
 * 3. **代码高亮 / 标题锚点 / 任务列表**与网页完全一致，不再有两套渲染口径。
 *
 * 剩下的工作是**清洗**：把网页专用、在 feed 里无意义甚至有害的东西去掉。
 */
function articleHtml(post: PostSummary, base: string): string {
  const sourcePath = toSourcePath(post.url)
  const rendered = getRenderedContent(sourcePath)
  if (!rendered) return ''

  /*
   * 第一种清洗：**删掉网页专用的交互属性**。
   *
   * - `srcset` / `sizes`：见下方 `absoluteUrls` 的说明，feed 里根本用不上，
   *   而且 srcset 里是相对路径，阅读器不会像网页那样解析它。
   * - `data-lightbox` / `data-origin-name` / `data-media-key` / `data-zoomable`：
   *   都是给客户端查看器的钩子，在阅读器里只是噪音。
   * - `loading` / `decoding`：feed 阅读器不支持懒加载，留着无意义。
   */
  const cleaned = rendered
    .replace(/\s(?:srcset|sizes|loading|decoding)="[^"]*"/gi, '')
    .replace(/\sdata-(?:lightbox|origin-name|media-key|zoomable)(?:="[^"]*")?/gi, '')
    /*
     * 第二种清洗：**把 `<figure>` 外壳压平**。
     *
     * 阅读器对 `<figure>` / `<a>` 的样式支持参差不齐，而 `prose-media__link`
     * 的点击放大在 feed 里是死链接。保留 `<img>` 与 `<figcaption>` 的内容即可，
     * 但 `<figcaption>` 在部分阅读器里会变成整段文字，所以图注用 `<p><small>` 表达。
     */
    .replace(/<a\b[^>]*class="prose-media__link"[^>]*>/gi, '')
    .replace(/<\/a>(?=\s*(?:<figcaption|<\/figure>))/gi, '')
    .replace(/<figcaption>([\s\S]*?)<\/figcaption>/gi, '<p><small>$1</small></p>')
    .replace(/<\/?figure\b[^>]*>/gi, '')

  /*
   * 第三种清洗：**把代码块压成阅读器能读的纯文本**（细节见 `support/feed-code.ts`）。
   *
   * 网页上的代码块有常驻头部、复制按钮、语言标识，`::: code-group` 还有
   * radio + label 的 tab 交互；这些在 feed 里没有 CSS 也没有 JS，只剩残渣。
   *
   * 放在链接绝对化**之前**：清洗会改变标签结构（拆包装层、删属性），
   * 让绝对化最后统一处理还在的 `src` / `href`，顺序才不会互相踩。
   */
  const feedSafe = sanitizeFeedCode(cleaned)

  /*
   * 第四种：把站内链接补成绝对地址。
   *
   * 两种情况要分清：
   * 1. 渲染产物里的站内地址**已带 base**（我们的媒体管线在渲染期就拼好了，
   *    例如 `/EmanyzwwwDocSite/assets/media/xxx.webp`）；
   * 2. 而 `SITE_URL` 从 CI 传入时**也可能已含子路径**。
   *
   * 两者直接相加就会得到 `/<repo>/<repo>/assets/...`（实测踩过）。
   * 所以先把 path 里的 base 剥掉，让 path 变成纯站点路径，
   * 再整体拼到 `SITE_URL` 上——此时 `SITE_URL` 承担全部前缀。
   */
  const bareBase = base.replace(/\/$/, '')

  return feedSafe.replace(/(src|href)="([^"]+)"/g, (whole, attr: string, url: string) => {
    // 已经是完整 URL / 协议相对 / 纯锚点 / data URI 的，原样保留
    if (/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(url)) return whole

    // 站内路径：先剥掉可能已存在的 base，再拼站点根
    let path = url.startsWith('/') ? url : `/${url}`
    if (bareBase && (path === bareBase || path.startsWith(`${bareBase}/`))) {
      path = path.slice(bareBase.length) || '/'
    }

    return `${attr}="${SITE_URL}${path}"`
  })
}

/** 生成一个语言的 RSS XML。 */
function buildFeed(locale: LocaleCode, posts: PostSummary[], base: string): string {
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
        `      <content:encoded>${escapeXml(articleHtml(post, base))}</content:encoded>`,
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

/**
 * 为每种语言写出订阅源。`outDir` 是构建产物目录。
 *
 * 每种语言一个 feed，落在该语言的前缀下：`/zh-cn/index.xml`、`/en/index.xml`。
 *
 * 正文来自 `support/rendered.ts` 收集的**已渲染 HTML**（`transformHtml` 阶段），
 * 因此这里不再需要读 Markdown 源码或自己渲染。`base` 是部署子路径
 * （`/EmanyzwwwDocSite/`），用来把 `/assets/...` 补成完整的绝对地址。
 */
export function writeFeeds(outDir: string): void {
  const base = process.env.VP_BASE ?? '/'
  const normalizedBase = base.endsWith('/') ? base : `${base}/`

  for (const locale of LOCALE_CODES) {
    const posts = readPosts(locale)
    const target = join(outDir, locale, 'index.xml')

    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, buildFeed(locale, posts, normalizedBase), 'utf-8')
  }
}
