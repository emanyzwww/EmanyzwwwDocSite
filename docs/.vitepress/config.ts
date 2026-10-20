/**
 * VitePress 站点配置。
 *
 * 这里是「构建配置」的唯一入口：路由、Markdown 解析、SEO、RSS。
 * 站点的**内容**（名称、导航、页脚）在 `data/site.ts`，
 * 个人信息在 `data/profile.ts`，界面文案在 `theme/i18n/`——各管一块，互不干扰。
 */

import { defineConfig } from 'vitepress'

import { LOCALES, SITE } from './data/site'
import { readPosts } from './support/content'
import { writeRobots } from './support/robots'
import { writeFeeds } from './support/rss'
import { pageCount } from './theme/support/pagination'
import type { LocaleCode } from './types'

/** 部署根路径。GitHub Pages 项目站点会通过环境变量覆盖成 `/<repo>/`。 */
const BASE = process.env.VP_BASE ?? '/'

/** 站点根地址（sitemap 与 RSS 的绝对链接用）。 */
const SITE_URL = (process.env.VP_SITE_URL ?? SITE.url).replace(/\/$/, '')

/**
 * sitemap 的 `hostname`，**必须带部署子路径**。
 *
 * VitePress 内部用 `new URL(page.url, hostname)` 拼绝对地址，而它给出的
 * `page.url` 是 `about/`、`en/posts/` 这种**相对**路径。URL 解析会以
 * hostname 的路径部分为基准，因此：
 *
 * - `hostname = https://owner.github.io` → `https://owner.github.io/about/`（丢掉 `/repo/`）
 * - `hostname = https://owner.github.io/repo/` → `https://owner.github.io/repo/about/`（正确）
 *
 * 这正是 GitHub Pages 项目站点 sitemap 全部指向域名根、404 的原因。
 */
const SITEMAP_HOSTNAME = new URL(BASE, new URL(SITE_URL).origin).href

/** 由页面路径判断语言（与运行时 `localeIndex` 的判定保持一致）。 */
function localeOfPage(relativePath: string): LocaleCode {
  return relativePath.startsWith('en/') ? 'en' : 'root'
}

/** `posts/hello-world/index.md` → `/posts/hello-world/`。 */
function toPath(relativePath: string): string {
  const withoutExt = relativePath.replace(/\.md$/, '')
  const withoutIndex = withoutExt.replace(/(^|\/)index$/, '$1')
  return `/${withoutIndex}`.replace(/\/{2,}/g, '/')
}

export default defineConfig({
  // ---------- 基础 ----------
  title: SITE.name,
  description: LOCALES.root.description,
  lang: LOCALES.root.lang,
  base: BASE,
  // 目录式 URL（/posts/hello-world/），不依赖服务器对 cleanUrls 的支持
  cleanUrls: false,
  // 草稿目录不参与构建；README 是给编辑器看的，不当页面
  srcExclude: ['**/_drafts/**', '**/README.md'],
  // 锚点跳转时给粘性页头留出空隙
  scrollOffset: 80,
  // 跟随系统 + 手动覆盖（VitePress 自带无闪烁初始化脚本）
  appearance: true,

  // ---------- Vite ----------
  vite: {
    server: {
      /**
       * 把构建产物与缓存排除在文件监听之外。
       *
       * 默认情况下 dev server 会监听整个项目目录，一旦执行 `pnpm build`，
       * `docs/.vitepress/dist` 里每个文件落盘都会触发一次 page reload（实测 26 次），
       * 浏览器表现为不停刷新。这里显式忽略，dev 与 build 可以同时用。
       */
      watch: {
        ignored: ['**/.vitepress/dist/**', '**/.vitepress/cache/**', '**/node_modules/**'],
      },
    },
  },

  // ---------- 语言 ----------
  locales: {
    root: {
      label: LOCALES.root.label,
      lang: LOCALES.root.lang,
      title: LOCALES.root.title,
      description: LOCALES.root.description,
    },
    en: {
      label: LOCALES.en.label,
      lang: LOCALES.en.lang,
      title: LOCALES.en.title,
      description: LOCALES.en.description,
    },
  },

  // ---------- Markdown ----------
  markdown: {
    // 与原站一致：代码块在明暗主题下都保持深色，因此用单主题
    theme: 'github-dark',
    lineNumbers: false,
    // 目录只收 H2/H3（原站 startLevel = 2 / endLevel = 3）
    headers: { level: [2, 3] },
    // 复制按钮的悬停提示；逐页本地化在运行时完成（见 theme/index.ts）
    codeCopyButtonTitle: 'Copy code',
  },

  // ---------- 站点地图 ----------
  sitemap: {
    // 必须含部署子路径，否则 URL 解析会把 /<repo>/ 吃掉（见上方 SITEMAP_HOSTNAME）
    hostname: SITEMAP_HOSTNAME,
  },

  // ---------- 页头静态标签 ----------
  head: [
    ['link', { rel: 'icon', href: `${BASE}favicon.svg`, type: 'image/svg+xml' }],
    ['meta', { name: 'color-scheme', content: 'light dark' }],
    ['meta', { name: 'author', content: SITE.author }],
  ],

  // ---------- 页面数据 ----------
  /**
   * Markdown 解析完成后补充页面数据。
   *
   * 动态路由（标签页、分页页）的标题与描述无法写在 Markdown 里，
   * 必须按参数算出来，否则所有标签页会共用同一个标题。
   */
  transformPageData(pageData) {
    const locale = localeOfPage(pageData.relativePath)
    const layout = pageData.frontmatter.layout

    // 标签详情页：标题 = 标签名
    if (layout === 'tag') {
      const slug = String(pageData.params?.tag ?? '')
      const tag = readPosts(locale)
        .flatMap((post) => post.tags)
        .find((item) => item.slug === slug)

      if (tag) {
        pageData.title = tag.label
        pageData.description = tag.label
      }
      return
    }

    // 文章分页页：标题 = 「文章 · 2/3」
    if (layout === 'posts' && pageData.params?.page) {
      const page = Number(pageData.params.page)
      const total = pageCount(readPosts(locale).length, SITE.postsPerPage)
      const base = String(pageData.frontmatter.title ?? '')
      pageData.title = base ? `${base} · ${page}/${total}` : `${page}/${total}`
      return
    }

    // 其余页面：没有描述时回退到站点描述
    if (!pageData.description) {
      pageData.description = LOCALES[locale].description
    }
  },

  // ---------- 页头标签（SEO / RSS） ----------
  transformHead({ pageData }) {
    const locale = localeOfPage(pageData.relativePath)
    const meta = LOCALES[locale]
    const canonical = `${SITE_URL}${toPath(pageData.relativePath)}`
    const feed = locale === 'en' ? `${BASE}en/index.xml` : `${BASE}index.xml`
    const title = pageData.title ? `${pageData.title} · ${meta.title}` : meta.title
    const description = pageData.description || meta.description

    return [
      ['link', { rel: 'canonical', href: canonical }],
      ['link', { rel: 'alternate', type: 'application/rss+xml', href: feed, title: meta.title }],
      ['meta', { property: 'og:title', content: title }],
      ['meta', { property: 'og:description', content: description }],
      [
        'meta',
        {
          property: 'og:type',
          content: pageData.frontmatter.layout ? 'website' : 'article',
        },
      ],
      ['meta', { property: 'og:url', content: canonical }],
      ['meta', { property: 'og:site_name', content: meta.title }],
      ['meta', { name: 'twitter:card', content: 'summary' }],
    ]
  },

  // ---------- 构建结束：写 RSS 与 robots ----------
  buildEnd(siteConfig) {
    writeFeeds(siteConfig.outDir)
    writeRobots(siteConfig.outDir, `${SITEMAP_HOSTNAME}sitemap.xml`)
  },
})
