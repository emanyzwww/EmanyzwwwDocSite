/**
 * 站点元信息。
 *
 * 这是「站点层面」的唯一事实来源：域名、品牌名、分页、侧栏顺序、页脚。
 * 页面文案在各自的 Markdown 里；个人信息在 `data/profile.ts`。
 */

import type { FooterConfig, LocaleCode, LocaleMeta, SiteMeta, WidgetName } from '../types'

/**
 * 站点根地址（不带结尾斜杠）。
 *
 * 必须是**真实可访问**的地址：sitemap、canonical、RSS 的绝对链接都从这里派生。
 * 之前写的是一个没有 DNS 记录的域名，导致本地 `pnpm build` 产出的 sitemap 与
 * canonical 全部指向打不开的地址，只有 CI 里 `VP_SITE_URL` 覆盖后才正确。
 *
 * 部署到子路径（如 GitHub Pages 项目站点）时，这里只写 origin，
 * 子路径由 `base`（`VP_BASE`）单独处理，见 `config.ts` 的 `SITEMAP_HOSTNAME`。
 */
const SITE_URL = 'https://emanyzwww.github.io'

/** 站点名（导航栏品牌、页脚、SEO 标题后缀）。 */
const SITE_NAME = 'EmanyzwwwDocSite'

/** 展示与 RSS 使用的时区。固定下来，避免构建机时区不同导致跨日。 */
const TIME_ZONE = 'Asia/Shanghai'

const footer: FooterConfig = {
  // 留空则自动生成「© 起始年–今年 站点名」
  copyright: '',
  // 页脚附加说明，支持 Markdown
  text: '',
  links: [
    { name: 'GitHub', url: 'https://github.com/emanyzwww' },
    { name: 'VitePress', url: 'https://vitepress.dev/' },
  ],
}

export const SITE: SiteMeta = {
  url: SITE_URL,
  name: SITE_NAME,
  author: 'Emanyzwww',
  since: 2026,
  timeZone: TIME_ZONE,
  postsPerPage: 10,
  homePostCount: 5,
  outline: true,
  wordCount: true,
  // 侧栏卡片渲染顺序。可选项：profile / tags / links / custom
  widgets: ['profile', 'tags', 'custom'] satisfies WidgetName[],
  footer,
  // 下面三项原来散落在各组件里，集中到这里便于统一调整
  recentPostsLimit: 5,
  tagSuggestLimit: 20,
  tagPreviewCount: 3,
}

/**
 * 语言元信息。
 *
 * `zh-cn` 与 `en` 地位对等：各自一个内容目录（`docs/zh-cn/`、`docs/en/`），
 * 各自一个 URL 前缀（`/zh-cn/`、`/en/`）。根路径 `/` 只放语言重定向，
 * 由浏览器语言决定落到哪边（见 `public/index.html`）。
 *
 * 每个语言目录的形态是固定的：
 * `index.md`（首页）+ `<YYYYMM>/<DDNN>/index.md`（文章）+ `pages/`（其它页面）。
 *
 * 新增语言时：这里加一条、`config.ts` 的 locales 加一段、`theme/i18n/` 加一份文案。
 */
export const LOCALES: Record<LocaleCode, LocaleMeta> = {
  'zh-cn': {
    lang: 'zh-CN',
    code: 'zh-cn',
    label: '简体中文',
    title: SITE_NAME,
    description: '一个记录想法、笔记和折腾过程的静态站点。',
    timeZone: TIME_ZONE,
  },
  en: {
    lang: 'en-US',
    code: 'en',
    label: 'English',
    title: SITE_NAME,
    description: 'A static site for notes, ideas, and things I am tinkering with.',
    timeZone: TIME_ZONE,
  },
}

/** 默认语言：浏览器语言匹配不上时落到这里。 */
export const DEFAULT_LOCALE: LocaleCode = 'zh-cn'

/** 全部语言代码，顺序即下拉菜单顺序。 */
export const LOCALE_CODES = Object.keys(LOCALES) as LocaleCode[]

/**
 * 把任意字符串收窄成 `LocaleCode`，不匹配时回退到默认语言。
 *
 * VitePress 的 `localeIndex` 是 `string` 类型，直接索引 `LOCALES` 会丢类型，
 * 因此所有「从外部取值当语言用」的地方都走这里。
 */
export function asLocale(value: unknown): LocaleCode {
  return LOCALE_CODES.includes(value as LocaleCode) ? (value as LocaleCode) : DEFAULT_LOCALE
}

/** 导航菜单（每种语言一份）。链接用目录式路径，与内容文件一一对应。 */
export const NAV: Record<LocaleCode, { text: string; link: string }[]> = {
  'zh-cn': [
    { text: '首页', link: '/zh-cn/' },
    { text: '文章', link: '/zh-cn/pages/posts/' },
    { text: '标签', link: '/zh-cn/pages/tags/' },
    { text: '关于', link: '/zh-cn/pages/about/' },
  ],
  en: [
    { text: 'Home', link: '/en/' },
    { text: 'Posts', link: '/en/pages/posts/' },
    { text: 'Tags', link: '/en/pages/tags/' },
    { text: 'About', link: '/en/pages/about/' },
  ],
}
