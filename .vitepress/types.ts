/**
 * 全站共享类型。
 *
 * 约定：这里的类型同时被构建期（Node）与运行期（浏览器）使用，
 * 因此不得引用任何 Node 内置模块或 Vite 专属 API。
 */

/**
 * 语言代码。
 *
 * 与目录结构一一对应：`docs/zh-cn/` → `zh-cn`（URL `/zh-cn/`），
 * `docs/en/` → `en`（URL `/en/`）。两者完全对称，没有「默认语言不带前缀」的特例。
 */
export type LocaleCode = 'zh-cn' | 'en'

/** 站点图片文件名 → 由 `theme/support/assets.ts` 解析为带指纹的 URL。 */
export type MediaFile = string

/** 一篇文章的摘要数据（构建期生成，随数据加载器下发到客户端）。 */
export interface PostSummary {
  /** 站点内绝对路径，如 `/posts/hello-world/`。 */
  url: string
  /** 展示标题。 */
  title: string
  /** 列表与 SEO 用的摘要（纯文本，≤160 字）。 */
  summary: string
  /** ISO 8601 时间串（完整时刻，用于 `content`/`data` 属性与排序）。 */
  date: string
  /** 站点时区下的日期部分 `YYYY-MM-DD`，用于 `<time datetime>`。 */
  isoDate: string
  /** 已按语言格式化的完整日期，如 `2026 年 10 月 19 日`。 */
  dateText: string
  /** 已按语言格式化的短日期，如 `10-19`。 */
  dateShort: string
  /** 年份，用于时间线分组。 */
  year: string
  /** 标签引用列表。 */
  tags: TagRef[]
  /** 正文字数（汉字按字、拉丁按词）。 */
  wordCount: number
  /** 是否为草稿（草稿不出现在任何列表中）。 */
  draft: boolean
  /** 所属语言。 */
  locale: LocaleCode
  /** 源文件相对 `docs/` 的路径，便于排查。 */
  filePath: string
}

/** 标签的最小引用（用于文章元信息、卡片等处）。 */
export interface TagRef {
  /** 展示名，如 `随笔`。 */
  label: string
  /** URL 片段，默认与 `label` 相同，可在 `data/taxonomy.ts` 覆盖。 */
  slug: string
  /** 标签页地址。 */
  url: string
}

/** 标签汇总（用于标签云、标签总览、侧栏标签卡）。 */
export interface TagSummary extends TagRef {
  /** 该标签下的文章数。 */
  count: number
  /** 该标签下的文章（按时间倒序）。 */
  posts: PostSummary[]
}

/** 图标名。新增图标需同时改 `theme/support/icons.ts`。 */
export type IconName =
  | 'sun'
  | 'moon'
  | 'globe'
  | 'zh'
  | 'en'
  | 'chevron-down'
  | 'arrow-right'
  | 'arrow-left'
  | 'calendar'
  | 'clock'
  | 'tag'
  | 'list'
  | 'rss'
  | 'github'
  | 'twitter'
  | 'mail'
  | 'link'

/** 个人资料中的一条社交链接。 */
export interface ProfileLink {
  label: string
  url: string
  icon?: IconName
}

/** 个人资料（数据源：`data/profile.ts`，构建期渲染 bio 后下发）。 */
export interface Profile {
  /** `media/` 下的文件名；留空则不显示头像。 */
  avatar: MediaFile
  name: string
  tagline: string
  /** 支持 Markdown。 */
  bio: string
  links: ProfileLink[]
  /** 侧栏标签卡最多显示几个标签。 */
  tagsLimit: number
}

/** 渲染后的个人资料（bio 已转为 HTML）。 */
export interface RenderedProfile extends Omit<Profile, 'bio'> {
  bioHtml: string
}

/** 自定义侧栏卡片定义（数据源：`data/widgets.ts`）。 */
export interface WidgetDef {
  /** 锚点 id（可选）。 */
  id?: string
  title?: string
  /** 支持 Markdown / HTML。 */
  content: string
  /** 设为 `false` 可临时停用。 */
  enabled?: boolean
}

/** 渲染后的自定义卡片（content 已转为 HTML）。 */
export interface RenderedWidget {
  id?: string
  title?: string
  html: string
}

/** 侧栏组件名。`custom` 渲染 `data/widgets.ts` 的全部卡片。 */
export type WidgetName = 'profile' | 'tags' | 'links' | 'custom'

/** 页脚配置。 */
export interface FooterConfig {
  /** 完整版权文本；留空则用 `© 起始年–今年 站点名`。 */
  copyright: string
  /** 附加说明，支持 Markdown。 */
  text: string
  /** 链接列表。 */
  links: { name: string; url: string }[]
}

/** 导航项。 */
export interface NavItem {
  text: string
  link: string
}

/** 站点级配置（数据源：`data/site.ts`）。 */
export interface SiteMeta {
  /** 站点根地址，不带结尾斜杠。 */
  url: string
  /** 站点名（品牌）。 */
  name: string
  author: string
  /** 版权起始年份。 */
  since: number
  /** 展示与 RSS 使用的时区。 */
  timeZone: string
  /** 列表每页文章数。 */
  postsPerPage: number
  /** 首页显示的文章数。 */
  homePostCount: number
  /** 是否默认生成目录。 */
  outline: boolean
  /** 是否显示字数。 */
  wordCount: boolean
  /** 侧栏卡片顺序。 */
  widgets: WidgetName[]
  footer: FooterConfig
}

/** 界面文案表。中英文必须实现同一份键（`Messages` 类型强制对齐）。 */
export interface Messages {
  skipToContent: string
  mainNav: string
  toggleTheme: string
  switchLanguage: string
  switchLanguageCurrent: string
  onThisPage: string
  tags: string
  links: string
  draft: string
  wordCount: string
  backToPosts: string
  allPosts: string
  previousPost: string
  nextPost: string
  postNav: string
  pagination: string
  previousPage: string
  nextPage: string
  noPostsYet: string
  noPostsInTerm: string
  termCount: string
  noTerms: string
  notFoundText: string
  backHome: string
  siteStats: string
  totalPosts: string
  totalTags: string
  tagCloudHint: string
  taxonomyOverview: string
  otherTags: string
  postsInTag: string
  recentPosts: string
  copyCode: string
  copied: string
}

/** 语言元信息。 */
export interface LocaleMeta {
  /** 浏览器 `<html lang>`。 */
  lang: string
  /** 界面文案语言。 */
  code: LocaleCode
  /** 下拉菜单里的显示名。 */
  label: string
  /** 站点标题。 */
  title: string
  /** 站点描述。 */
  description: string
  /** 该语言的展示时区（日期格式化与 RSS 用）。 */
  timeZone: string
}
