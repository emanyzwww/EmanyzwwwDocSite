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
import { buildTagIndex, readPageUrls, readPosts } from './support/content'
import { devRootRedirect } from './support/dev-redirect'
import { applySiteMarkdown } from './support/markdown'
import { mediaMarkdown } from './support/media/render'
import { mediaPlugin } from './support/media/vite'
import { writeNotFoundFallback } from './support/not-found'
import { collectRenderedContent } from './support/rendered'
import { writeRobots } from './support/robots'
import { writeFeeds } from './support/rss'
import { buildTranslationIndex, translatedUrl } from './support/translation'
import { toPageUrl } from './support/urls'
import { pageCount } from './theme/support/pagination'
import type { LocaleCode, TagRef } from './types'

/** 部署根路径。GitHub Pages 项目站点会通过环境变量覆盖成 `/<repo>/`。 */
const BASE = process.env.VP_BASE ?? '/'

/**
 * 站点根地址（sitemap 与 RSS 的绝对链接用）。
 */
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

/**
 * 标签索引缓存：每种语言建一次，避免每个标签页都遍历全部文章。
 */
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
 * **只在「目标语言确实存在该页面」时才输出那一条。**
 *
 * 中英两种语言的普通页面地址只差第一段，直接替换语言段就对；但**标签页不是**：
 * 中英标签的 slug 不同（`随笔` vs `Essay`），盲目替换会得到
 * `/en/tags/%E9%9A%8F%E7%AC%94/` —— 实测 404。
 *
 * 按 Google 的 hreflang 规范，指向 404 的互指会让**整组失效**
 * （连本可生效的 about / posts 页也可能被一起丢弃），
 * 因此「不输出错的互指」比「输出了但指向 404」好得多。
 *
 * 存在性判断复用 `readPageUrls()`（全站内容页的编码后地址），
 * 与 `pages.data.ts` 下发给客户端的索引同源，不另建一套口径。
 */
function alternateLinks(
  relativePath: string,
  path: string,
  known: Set<string>,
): [string, Record<string, string>][] {
  const locale = localeOfPage(relativePath)
  const bare = path.slice(locale.length + 1) // `/zh-cn/about/` → `/about/`

  const links: [string, Record<string, string>][] = []

  for (const code of LOCALE_CODES) {
    // 当前语言的这一页**一定存在**（我们正在渲染它），无条件输出。
    if (code === locale) {
      links.push([
        'link',
        { rel: 'alternate', hreflang: LOCALES[code].lang, href: `${SITE_URL}${path}` },
      ])
      continue
    }

    /*
     * 其它语言按两级判断：
     * 1. 文章：按配对键取目标语言同键文章的真实地址——
     *    slug 本地化后各语言路径不同名，路径替换必然失配；
     * 2. 非文章：同名路径存在才输出。标签页的 URL 由 `index.paths.ts`
     *    构建期按实际标签动态生成，`readPageUrls()` 里只有模板文件
     *    `tags/[tag]/index.md`，拿不到 `tags/随笔/`；因此宁可少输出一条，
     *    也不要输出一条指向 404 的互指（那会让整组 hreflang 失效）。
     */
    const target =
      translatedUrl(translationIndexOf(), urlKeyByUrl().get(path) ?? null, code) ??
      (known.has(`/${code}${bare}`) ? `/${code}${bare}` : null)
    if (!target) continue

    links.push([
      'link',
      { rel: 'alternate', hreflang: LOCALES[code].lang, href: `${SITE_URL}${target}` },
    ])
  }

  // 只有至少存在一个有效互指时才补 x-default，否则单条 x-default 也无意义
  if (links.length > 1) {
    links.push([
      'link',
      {
        rel: 'alternate',
        hreflang: 'x-default',
        href: `${SITE_URL}/${DEFAULT_LOCALE}${bare}`,
      },
    ])
  }

  return links
}

/**
 * 全站内容页路径集合（编码后的站点路径，不含 base）。
 *
 * 用于判断「另一种语言有没有同名页面」，避免 hreflang 指向 404。
 * 与 `data/pages.data.ts` 下发给客户端的索引同源（都走 `readPageUrls()`），
 * 所以构建期与运行期的「页面是否存在」判断永远一致。
 *
 * 懒建：只在第一次 `transformHead` 时遍历一次，避免 config 加载期就扫盘。
 */
let knownPagesCache: Set<string> | null = null
function knownPages(): Set<string> {
  knownPagesCache ??= new Set(readPageUrls())
  return knownPagesCache
}

/**
 * 文章跨语言配对索引（编码后的站点路径 → 配对键）。
 *
 * 文章 slug 本地化后（中文目录「你好，世界」）各语言路径不再同名，
 * `alternateLinks` 原先的「整条路径换前缀」判断会漏掉正确的互指。
 * 改为复用 `support/translation.ts` 的配对键：当前页是文章时，
 * 反查它的键，再取目标语言同键文章的真实地址。
 *
 * 与 `pages.data.ts` / `useLocaleSwitch.ts` 同源（都走 `readPosts()`），
 * 懒建方式同 `knownPages()`。
 */
let translationIndexCache: ReturnType<typeof buildTranslationIndex> | null = null
function translationIndexOf(): ReturnType<typeof buildTranslationIndex> {
  translationIndexCache ??= buildTranslationIndex(readPosts())
  return translationIndexCache
}

/** 文章地址（编码后）→ 配对键。给 `alternateLinks` 由当前页反查配对键用。 */
let urlKeyCache: Map<string, string> | null = null
function urlKeyByUrl(): Map<string, string> {
  if (!urlKeyCache) {
    urlKeyCache = new Map()
    for (const [key, urls] of translationIndexOf()) {
      for (const url of Object.values(urls)) urlKeyCache.set(url, key)
    }
  }
  return urlKeyCache
}

/**
 * 社交分享缩略图（绝对地址）。
 *
 * 只在 `media/` 里存在分享图时才输出 `og:image`。
 * 现在还没有专门的分享图，因此留空 —— 等放了一张 1200×630 的
 * `media/og.png` 之后，把文件名填进这里即可自动生效。
 */
const OG_IMAGE_NAME = ''
const OG_IMAGE = OG_IMAGE_NAME ? `${SITE_URL}${BASE}${OG_IMAGE_NAME}` : ''

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
  /**
   * `vue.template.transformAssetUrls` 只处理**相对路径**，不再改写绝对路径。
   *
   * `query: ''` 不影响任何东西，这里的关键是 `includeAbsolute: false`。
   *
   * ---------- 为什么必须关掉绝对路径的改写 ----------
   *
   * 站内图片的 URL 现在由 `support/media/` 算出（文件名是**源图内容 sha256**），
   * Vite 不认识这个键。若不关，它会把 `<img src="/assets/media/ab12-672.webp">`
   * 再次当成模块去解析，结果是二选一：
   *
   * - 目标文件不存在 → `Rollup failed to resolve import`，构建**直接失败**；
   * - 目标文件恰好存在 → 被 Vite **按内容重新哈希**，我们算的指纹作废、
   *   产物里还多出一份副本。
   *
   * 关掉之后：
   * - 绝对路径原样保留（我们自己拼 base，见 `media/planner.ts` 的 `withBase`）；
   * - **相对路径仍然会被 import** —— 这是好事：作者写错相对路径时依旧会
   *   在构建期 hard fail，而不是静默产出一个 404 的 URL。
   */
  vue: {
    template: {
      transformAssetUrls: {
        includeAbsolute: false,
      },
    },
  },

  vite: {
    /**
     * `public/` 在仓库根（与 `media/` 一起，属于站点资源而非内容）。
     *
     * 必须给**绝对路径**：Vite 的 `publicDir` 相对 root（= `srcDir`，即 `docs/`）
     * 解析，写成 `'public'` 会落到并不存在的 `docs/public`，于是 favicon 与
     * 根路径跳转页都不会被拷贝，dev 下也会被 SPA fallback 吞掉。
     */
    publicDir: fileURLToPath(new URL('../public', import.meta.url)),
    plugins: [
      devRootRedirect(BASE),
      /*
       * 媒体管线。构建期在 `buildStart` 预扫并转码，`generateBundle` 发射；
       * dev 下走中间件按需转码。两者的命名规则完全一致，所以「本地看着对」
       * 与「线上正确」是同一件事。
       */
      mediaPlugin({ base: BASE }),
    ],
    /**
     * **必须关掉资源内联。**
     *
     * Vite 默认把 <4096 B 的资源转成 `data:` URI。对我们的管线有两个后果：
     * 1. 小图的**内容指纹文件名直接消失**，去重与缓存全部失效；
     * 2. 内联进 `srcset` 后，逗号会把 `data:` URI 本身切开，变成无效候选。
     *
     * 我们自己的产物不走 Vite 资产管线（URL 由 `support/media/` 算出），
     * 但 `media/` 下的头像等仍走 `?url` 导入，所以这条要显式设。
     */
    build: {
      assetsInlineLimit: 0,
    },
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
    /*
     * 代码块在明暗主题下都保持深色，因此用单主题。
     *
     * 用 `github-dark-default`（GitHub 现行配色）而不是旧的 `github-dark`：
     * 旧主题的注释色 `#6a737d` 在 `--bg-code #0d1014` 上只有 **3.96:1**，
     * 低于 WCAG AA 的 4.5:1 —— 而本站正文明亮、代码块恒深色，
     * 注释是最常被扫读的部分之一。新主题的注释色 `#8b949e` 是 **6.20:1**。
     */
    theme: 'github-dark-default',
    lineNumbers: false,
    // 右栏目录收集哪些级别的标题。H1 留给页面标题（模板已渲染），所以正文从 ## 起。
    // 想收更多层级就加数字，例如 [2, 3, 4]；只收两级就用 [2, 3]。
    headers: { level: [2, 3] },
    // 复制按钮的悬停提示；逐页本地化在运行时完成（见 theme/index.ts）
    codeCopyButtonTitle: 'Copy code',
    /*
     * 本站的 Markdown 扩展全部从 `support/markdown/` 装配：
     *
     * - 行内：`==高亮==`、GFM 任务列表
     * - 块级：`:::github` / `:::link` / `:::figure` / `:::quote`
     * - 图片：`<figure>` + 多档 srcset + 点开放大
     *
     * 这里是 VitePress 留给用户挂 markdown-it 插件的唯一入口，在它自带的
     * 插件（attrs / emoji / 内置容器 / 锚点 / 图片）之后执行，互不覆盖。
     *
     * ## 为什么装饰器式地传一个 `media` 而不是在这里逐个调用
     *
     * 同一套扩展还要用于「非页面」的 Markdown（个人简介、纯文本侧栏卡片），
     * 那些场景**没有** Vite 的资产清单，不能装媒体管线。把"装什么"收敛到
     * `applySiteMarkdown()`，两条路径就不会再次漂移成两套语法。
     */
    config: (md) => {
      applySiteMarkdown(md, { media: mediaMarkdown })
    },
  },

  // ---------- 站点地图 ----------
  sitemap: {
    // 必须含部署子路径，否则 URL 解析会把 /<repo>/ 吃掉（见上方 SITEMAP_HOSTNAME）
    hostname: SITEMAP_HOSTNAME,
  },

  // ---------- 页头静态标签 ----------
  head: [
    /*
     * ---------- 视口 ----------
     *
     * 必须**显式覆盖** VitePress 默认注入的那一条。原因是默认值
     * `width=device-width,initial-scale=1` 里没有 `viewport-fit=cover`，
     * 而全站的 `env(safe-area-inset-*)` 只有带了这个值才返回真实的非 0 像素。
     *
     * 换句话说：CSS 里写了三处安全区适配，但只要这一条 meta 不对，
     * 它们就全部恒等于 0 —— 刘海屏 / 圆角屏上底栏被切角，且完全看不出来。
     *
     * VitePress 1.6.4 的 `isMetaViewportOverridden()` 会检查 `head` 里是否
     * 已存在 `name="viewport"` 的 meta，存在则不再注入自己的默认值。
     *
     * `interactive-widget=resizes-content`：Chrome Android 的默认值是
     * `resizes-visual`（虚拟键盘弹出时不重排 layout viewport），改成
     * `resizes-content` 后底部固定元素会跟着一起重排。
     * **它只管键盘，不管工具栏**，而且 iOS Safari 不支持 ——
     * 工具栏收放的跟随由 `MobileDock` 外层的 `100dvh` 容器负责，别混为一谈。
     */
    [
      'meta',
      {
        name: 'viewport',
        content:
          'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content',
      },
    ],
    ['link', { rel: 'icon', href: `${BASE}favicon.svg`, type: 'image/svg+xml' }],
    ['meta', { name: 'color-scheme', content: 'light dark' }],
    ['meta', { name: 'author', content: SITE.author }],

    /*
     * ---------- 安全相关的 meta ----------
     *
     * GitHub Pages **不允许自定义响应头**，所以 CSP / Referrer-Policy 这类
     * 只能靠 `<meta>` 补齐（能补的部分）。
     *
     * 1. Referrer：meta 形式与响应头等价，现代浏览器都认。
     *    本站外链只有 GitHub / X / VitePress 官网，默认只发 origin、
     *    不发具体文章路径，避免把「你在读哪篇笔记」泄漏给外链站点。
     *
     * 2. CSP：**注意两处硬限制**
     *    - `frame-ancestors`、`report-uri`、`sandbox` 在 meta 里被浏览器
     *      忽略（MDN 有明确说明），所以「点击劫持」这一项在 Pages 上补不了，
     *      只能将来换托管或前置 CDN 时用真实响应头解决；
     *    - VitePress 会内联 3 段脚本（明暗初始化、mac 检测、站点数据），
     *      因此 `script-src` 必须留 `'unsafe-inline'`，否则暗色模式、
     *      路由数据全挂。这些脚本都是构建产物、不含任何用户输入，
     *      留 `'unsafe-inline'` 的实际风险远小于「把本站当攻击入口」。
     *
     *    `form-action 'none'` 是安全的：全站 0 个 `<form>`。
     *    `object-src 'none'` 禁掉 Flash/Java 时代的插件内容。
     */
    ['meta', { name: 'referrer', content: 'strict-origin-when-cross-origin' }],
    [
      'meta',
      {
        'http-equiv': 'Content-Security-Policy',
        content: [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline'",
          "style-src 'self' 'unsafe-inline'",
          // 头像等图片走同源 + data:（Vite 可能内联小图）
          "img-src 'self' data:",
          "font-src 'self'",
          /*
           * connect-src 的额外域名给「链接悬浮预览」用：
           * - api.github.com：仓库卡（stars / 语言 / 更新时间），
           *   该接口返回 Access-Control-Allow-Origin: *，浏览器可直接调；
           * - bilibili 的 web 接口拒绝第三方站点的跨域请求（带 Origin 即
           *   403 且无 CORS 头），纯静态站无法实时拉取，已降级为不发请求的
           *   域名卡（见 providers.ts），故不需要出现在白名单里；
           *   将来若加同源代理（如 Pages Functions），代理是同源请求，
           *   'self' 已覆盖，同样不用加。
           * 新增链接 provider 时，其 API 域名必须同步加进这里，
           * 否则 fetch 会被 CSP 静默拦截（表现为永远降级成通用卡）。
           */
          "connect-src 'self' https://api.github.com",
          "media-src 'self'",
          "manifest-src 'self'",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'none'",
        ].join('; '),
      },
    ],
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
      // 语言互指：只在目标语言的同名页面真实存在时才输出（标签页 slug 中英不同）
      ...alternateLinks(pageData.relativePath, path, knownPages()),
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
      // 社交分享缩略图：没有 og:image 时，各平台只能抓一张随机图或留白
      ...(OG_IMAGE
        ? ([['meta', { property: 'og:image', content: OG_IMAGE }]] as [
            string,
            Record<string, string>,
          ][])
        : []),
      ['meta', { name: 'twitter:card', content: OG_IMAGE ? 'summary_large_image' : 'summary' }],
    ]
  },

  /*
   * ---------- 构建结束：写 RSS、robots、404 兜底 ----------
   *
   * 这里**不做任何网络请求、也不再改写已写盘的产物**。
   *
   * 改造前这里有一段 `resolveRepoCards()` + `rewriteRepoCardsInDist()`：
   * 构建期去 GitHub 抓仓库数据，然后对 `dist` 下所有 HTML 做正则替换。
   * 它带来三个结构性问题（详见 `AUDIT-markdown-2026-10-26.md`）：
   *
   * 1. **构建依赖网络**：缓存过期就要联网，断网/限流时构建结果不可复现；
   * 2. **改写不完整**：只覆盖 `.html`，覆盖不到客户端路由用的 `.js` chunk，
   *    于是首屏和站内跳转渲染出两种卡片；
   * 3. **替换只命中首处**：同一仓库在页面上出现多次时，第 2 张起不会被改写，
   *    还会把 `data-repo-card` 标记泄漏进页面源码。
   *
   * 现在数据由浏览器补（`theme/embeds/`），构建只产出「一条可点的链接」。
   * 构建因此是**纯函数**：同样的输入永远得到同样的产物。
   */
  buildEnd(siteConfig) {
    writeFeeds(siteConfig.outDir)
    writeRobots(siteConfig.outDir, `${SITEMAP_HOSTNAME}sitemap.xml`)
    // 404 页是纯 SPA 空壳，补一段无 JS 也能用的返回入口
    writeNotFoundFallback(siteConfig.outDir, BASE.endsWith('/') ? BASE : `${BASE}/`)
  },

  transformHtml(code, _id, ctx) {
    /*
     * 收集「VitePress 已渲染好的正文」，供 RSS 复用。
     *
     * 只有这个时机能拿到最终 HTML：图片已被 Vite 指纹化成
     * `/assets/banner.<hash>.webp`、`{width=100}` 这类 attrs 已被消费、
     * 代码块已高亮、标题已有锚点。RSS 直接用这份 HTML，
     * 就不会再出现「feed 里的图是 ./banner.webp（部署后不存在）」的问题。
     *
     * `pageData.relativePath` 含语言前缀（实测 `zh-cn/posts/.../index.md`），
     * 与 `RawDoc.filePath` 同一口径，因此可以直接当 Map 的 key。
     */
    const relativePath = ctx.pageData?.relativePath
    if (relativePath) {
      collectRenderedContent(relativePath, code)
    }
    return code
  },
})
