/**
 * VitePress 站点配置。
 *
 * 这里是「构建配置」的唯一入口：路由、Markdown 解析、SEO、RSS。
 * 站点的**内容**（名称、导航、页脚）在 `data/site.ts`，
 * 个人信息在 `data/profile.ts`，界面文案在 `theme/i18n/`——各管一块，互不干扰。
 */

import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitepress'

import { DEFAULT_LOCALE, LOCALE_CODES, LOCALES, SITE } from './data/site'
import { buildTagIndex, readPosts } from './support/content'
import { devRootRedirect } from './support/dev-redirect'
import { writeRobots } from './support/robots'
import { writeFeeds } from './support/rss'
import { toPageUrl } from './support/urls'
import { pageCount } from './theme/support/pagination'
import type { LocaleCode, TagRef } from './types'

/** 部署根路径。GitHub Pages 项目站点会通过环境变量覆盖成 `/<repo>/`。 */
const BASE = process.env.VP_BASE ?? '/'

/** 站点根地址（sitemap 与 RSS 的绝对链接用）。 */
const SITE_URL = (process.env.VP_SITE_URL ?? SITE.url).replace(/\/$/, '')

/**
 * sitemap 的 `hostname`，**必须带部署子路径**。
 *
 * VitePress 内部用 `new URL(page.url, hostname)` 拼绝对地址，而它给出的
 * `page.url` 是 `zh-cn/about/`、`en/posts/` 这种**相对**路径。URL 解析会以
 * hostname 的路径部分为基准，因此：
 *
 * - `hostname = https://owner.github.io` → `https://owner.github.io/zh-cn/about/`（丢掉 `/repo/`）
 * - `hostname = https://owner.github.io/repo/` → `https://owner.github.io/repo/zh-cn/about/`（正确）
 *
 * 这正是 GitHub Pages 项目站点 sitemap 全部指向域名根、404 的原因。
 */
const SITEMAP_HOSTNAME = new URL(BASE, new URL(SITE_URL).origin).href

/**
 * 由页面路径判断语言：第一段目录名就是语言（`zh-cn/` 或 `en/`）。
 *
 * 与 VitePress 的 `localeIndex` 判定保持一致——`locales` 的 key 就是 URL 前缀。
 */
function localeOfPage(relativePath: string): LocaleCode {
  const first = relativePath.split('/')[0]
  return LOCALE_CODES.includes(first as LocaleCode) ? (first as LocaleCode) : DEFAULT_LOCALE
}

/** 标签索引缓存：每种语言建一次，避免每个标签页都遍历全部文章。 */
const tagIndexCache = new Map<LocaleCode, Map<string, TagRef>>()

function tagIndexOf(locale: LocaleCode): Map<string, TagRef> {
  let index = tagIndexCache.get(locale)
  if (!index) {
    index = buildTagIndex(locale)
    tagIndexCache.set(locale, index)
  }
  return index
}

/**
 * 语言互指的 `<link rel="alternate" hreflang>` 组。
 *
 * 中英是**平级前缀**，两种语言的同一页面地址只差第一段，因此直接替换语言段即可。
 * 另外补一个 `x-default` 指向默认语言，告诉搜索引擎「语言匹配不上时用哪个」。
 */
function alternateLinks(relativePath: string, path: string): [string, Record<string, string>][] {
  const locale = localeOfPage(relativePath)
  const bare = path.slice(locale.length + 1) // `/zh-cn/about/` → `/about/`

  const links = LOCALE_CODES.map(
    (code) =>
      [
        'link',
        {
          rel: 'alternate',
          hreflang: LOCALES[code].lang,
          href: `${SITE_URL}/${code}${bare}`,
        },
      ] as [string, Record<string, string>],
  )

  links.push([
    'link',
    {
      rel: 'alternate',
      hreflang: 'x-default',
      href: `${SITE_URL}/${DEFAULT_LOCALE}${bare}`,
    },
  ])

  return links
}

export default defineConfig({
  // ---------- 基础 ----------
  // `.vitepress` 在仓库根，内容在 `docs/`：这三个目录必须显式声明，
  // 否则会按命令行传入的 root（这里是 `.`）解析成 ./dist、./cache。
  srcDir: 'docs',
  outDir: '.vitepress/dist',
  cacheDir: '.vitepress/cache',
  title: SITE.name,
  description: LOCALES[DEFAULT_LOCALE].description,
  lang: LOCALES[DEFAULT_LOCALE].lang,
  base: BASE,
  // 目录式 URL（/zh-cn/posts/x/），不依赖服务器对 cleanUrls 的支持
  cleanUrls: false,
  // 草稿目录不参与构建；README 是给编辑器看的，不当页面
  srcExclude: ['**/_drafts/**', '**/README.md'],
  // 锚点跳转时给粘性页头留出空隙
  scrollOffset: 80,
  // 跟随系统 + 手动覆盖（VitePress 自带无闪烁初始化脚本）
  appearance: true,

  // ---------- Vite ----------
  vite: {
    /**
     * `public/` 在仓库根（与 `media/` 一起，属于站点资源而非内容）。
     *
     * 必须给**绝对路径**：Vite 的 `publicDir` 相对 root（= `srcDir`，即 `docs/`）
     * 解析，写成 `'public'` 会落到并不存在的 `docs/public`，于是 favicon 与
     * 根路径跳转页都不会被拷贝，dev 下也会被 SPA fallback 吞掉。
     */
    publicDir: fileURLToPath(new URL('../public', import.meta.url)),
    plugins: [devRootRedirect(BASE)],
    server: {
      /**
       * 把构建产物与缓存排除在文件监听之外。
       *
       * 默认情况下 dev server 会监听整个项目目录，一旦执行 `pnpm build`，
       * `.vitepress/dist` 里每个文件落盘都会触发一次 page reload（实测 26 次），
       * 浏览器表现为不停刷新。这里显式忽略，dev 与 build 可以同时用。
       */
      watch: {
        ignored: ['**/.vitepress/dist/**', '**/.vitepress/cache/**', '**/node_modules/**'],
      },
    },
  },

  // ---------- 语言 ----------
  // key 就是 URL 前缀，也是 `docs/` 下的目录名。两者必须一一对应。
  locales: {
    'zh-cn': {
      label: LOCALES['zh-cn'].label,
      lang: LOCALES['zh-cn'].lang,
      title: LOCALES['zh-cn'].title,
      description: LOCALES['zh-cn'].description,
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
      // 构建期建一次索引，避免每个标签页都遍历全部文章
      const tag = tagIndexOf(locale).get(slug)

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
    // 404 页没有规范地址，也不该被索引：整块 SEO 标签都跳过
    if (pageData.isNotFound) {
      return [['meta', { name: 'robots', content: 'noindex' }]]
    }

    const path = toPageUrl(pageData.relativePath)
    const canonical = `${SITE_URL}${path}`
    // 每种语言的 feed 落在自己的前缀下：/zh-cn/index.xml、/en/index.xml
    const feed = `${BASE}${locale}/index.xml`
    const title = pageData.title ? `${pageData.title} · ${meta.title}` : meta.title
    const description = pageData.description || meta.description

    return [
      ['link', { rel: 'canonical', href: canonical }],
      ['link', { rel: 'alternate', type: 'application/rss+xml', href: feed, title: meta.title }],
      // 语言互指：中英是平级前缀，缺了这组标签搜索引擎不知道两者是同一内容的译本
      ...alternateLinks(pageData.relativePath, path),
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
