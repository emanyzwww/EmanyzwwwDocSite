/**
 * 站点元信息。
 *
 * 这是「站点层面」的唯一事实来源：域名、品牌名、分页、侧栏顺序、页脚。
 * 页面文案在各自的 Markdown 里；个人信息在 `data/profile.ts`。
 */

import type { FooterConfig, LocaleMeta, SiteMeta, WidgetName } from '../types'

/** 站点根地址（不带结尾斜杠）。部署到子路径时由 `base` 单独处理。 */
const SITE_URL = 'https://emanyzoo.cn'

/** 站点名（导航栏品牌、页脚、SEO 标题后缀）。 */
const SITE_NAME = 'Emanyzwww'

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
}

/**
 * 语言元信息。
 * `root` 是默认语言（简体中文，不带路径前缀），`en` 位于 `/en/`。
 * 新增语言时：这里加一条、`config.ts` 的 locales 加一段、`theme/i18n/` 加一份文案。
 */
export const LOCALES: Record<'root' | 'en', LocaleMeta> = {
  root: {
    lang: 'zh-CN',
    code: 'root',
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

/** 导航菜单（每种语言一份）。链接用目录式路径，与内容文件一一对应。 */
export const NAV: Record<'root' | 'en', { text: string; link: string }[]> = {
  root: [
    { text: '首页', link: '/' },
    { text: '文章', link: '/posts/' },
    { text: '标签', link: '/tags/' },
    { text: '关于', link: '/about/' },
  ],
  en: [
    { text: 'Home', link: '/en/' },
    { text: 'Posts', link: '/en/posts/' },
    { text: 'Tags', link: '/en/tags/' },
    { text: 'About', link: '/en/about/' },
  ],
}
