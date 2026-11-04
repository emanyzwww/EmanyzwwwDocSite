/**
 * 全站共享类型。
 *
 * 约定：这里的类型同时被构建期（Node）与运行期（浏览器）使用，
 * 因此不得引用任何 Node 内置模块或 Vite 专属 API。
 */

/**
 * 语言代码。
 *
 * 与目录结构一一对应：文章里是 `docs/<YYYYMM>/<DDNN>/<lang>/`，
 * 站点页面里是 `docs/site/<lang>/`；同时就是 URL 前缀 `/zh-cn/`、`/en/`。
 * 两者完全对称，没有「默认语言不带前缀」的特例。
 */
export type LocaleCode = 'zh-cn' | 'en'

/** 站点图片文件名 → 由 `theme/support/media.ts` 解析为带指纹的 URL。 */
export type MediaFile = string

/** 一篇文章的摘要数据（构建期生成，随数据加载器下发到客户端）。 */
export interface PostSummary {
  /** 站点内绝对路径，如 `/zh-cn/202610/1901/你好，世界/`。 */
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
  /** 阅读时长（分钟，最小 1；中文 350 字/分、拉丁 200 词/分）。 */
  readingMinutes: number
  /**
   * 作者显式写的导语（frontmatter `description`）；不写、写空、
   * 或与正文首段重复时为 `null`。
   *
   * **不要用 `summary` 代替**：`summary` 在没有 description 时会退到正文首段，
   * 直接当导语显示会与正文第一段重复。
   */
  lead: string | null
  /**
   * 更新时刻（ISO）；`updated` 早于发布日或与发布日同一天时为 `null`。
   *
   * 显示口径：只有「更新日与发布日不是同一天」才值得告诉读者（`updatedText`）。
   */
  updated: string | null
  /** 更新日期的 `YYYY-MM-DD`（站点时区，用于 `<time datetime>`）；无更新为 `null`。 */
  updatedIso: string | null
  /** 更新时间展示文本（同年 `MM-DD`、跨年 `YYYY-MM-DD`）；无更新为 `null`。 */
  updatedText: string | null
  /** 所属语言。 */
  locale: LocaleCode
  /**
   * 跨语言配对键（同一篇文章各语言版本共享；详见 `support/translation.ts`）。
   *
   * 由文章源路径的父目录 `<YYYYMM>/<DDNN>` 唯一决定，与 frontmatter 无关。
   * 没有稳定键的页面（`site/**` 下的站点页面）为 `null`，语言切换对它们退回路径匹配。
   */
  pairKey: string | null
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

/** 目录（右栏 TOC）里的一个节点，可任意深地嵌套。 */
export interface OutlineItem {
  /** 标题文字。 */
  title: string
  /** 锚点 id。 */
  slug: string
  /** 标题级别（2 = H2、3 = H3、4 = H4）。 */
  level: number
  /** 子节点。 */
  children: OutlineItem[]
}

/** 图标名。新增图标需同时改 `shared/icons.ts`。 */
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
  | 'menu'
  | 'close'
  | 'search'
  | 'home'
  | 'toc'
  | 'arrow-up'
  // ---------- 图片查看器 ----------
  | 'zoom-in'
  | 'zoom-out'
  | 'download'
  | 'fit'
  // ---------- 链接预览卡 ----------
  | 'play'
  // ---------- 嵌入块（块级指令） ----------
  /** 仓库卡的 stars 前缀。 */
  | 'star'
  /** `:::quote` 的装饰引号。 */
  | 'quote'
  /** `:::figure` 的类型标识。 */
  | 'image'
  /** `:::columns` 的类型标识。 */
  | 'columns'
  /** 卡片右上角的「可以点出去」提示。 */
  | 'external'

/** 个人资料中的一条社交链接。 */
export interface ProfileLink {
  label: string
  /**
   * 按语言覆盖的可读名称（`title` / `aria-label`）。
   *
   * 图标按钮没有可见文字，读屏与 hover 提示是它唯一的「名字」——
   * 所以这个名字必须跟当前语言走。缺省回退到 `label`。
   */
  labelI18n?: Partial<Record<LocaleCode, string>>
  url: string
  icon?: IconName
}

/** 资料卡里随语言变化的那部分文案。 */
export interface ProfileCopy {
  /** 名字下方的一行小字。 */
  tagline: string
  /** 自我介绍，支持 Markdown（构建期渲染）。 */
  bio: string
}

/** 个人资料（数据源：`data/profile.ts`，构建期渲染 bio 后下发）。 */
export interface Profile {
  /** `media/` 下的文件名；留空则不显示头像。 */
  avatar: MediaFile
  name: string
  /** 默认语言（`zh-cn`）的 tagline，同时是其它语言缺省时的回退值。 */
  tagline: string
  /** 默认语言（`zh-cn`）的 bio，支持 Markdown。 */
  bio: string
  /**
   * 其它语言的覆盖文案。
   *
   * 为什么不用一份「按语言取值」的函数：本文件同时被构建期与浏览器使用，
   * 而 bio 需要在构建期渲染成 HTML —— 只能把所有语言各渲染一份、让组件按
   * 当前语言挑（见 `RenderedProfile.i18n`）。个人资料是站点级常量，
   * 多渲染一次 Markdown 的成本可以忽略。
   */
  i18n?: Partial<Record<LocaleCode, ProfileCopy>>
  links: ProfileLink[]
  /** 侧栏标签卡最多显示几个标签。 */
  tagsLimit: number
}

/** 渲染后的个人资料（每种语言的 bio 都已转为 HTML）。 */
export interface RenderedProfile extends Omit<Profile, 'bio' | 'i18n'> {
  /** 默认语言（`zh-cn`）的 bio HTML，保留给不关心语言的调用方。 */
  bioHtml: string
  /** 每种语言一份；`zh-cn` 始终存在，其它语言缺省时回退到它。 */
  i18n: Record<LocaleCode, { tagline: string; bioHtml: string }>
}

/** 侧栏组件名。 */
export type WidgetName = 'profile' | 'tags'

/** 页脚配置。 */
export interface FooterConfig {
  /** 完整版权文本；留空则用 `© 起始年–今年 站点名`。 */
  copyright: string
  /** 链接列表。 */
  links: { name: string; url: string }[]
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
  /** 侧栏「最近文章」卡片显示几条。 */
  recentPostsLimit: number
  /** 标签详情页底部「其他标签」最多显示几个。 */
  tagSuggestLimit: number
  /** 标签总览页里每个标签预览几篇文章（超出时给「查看全部」）。 */
  tagPreviewCount: number
  /** 是否默认生成目录。 */
  outline: boolean
  /** 是否显示字数。 */
  wordCount: boolean
  /** 是否显示阅读时长（由字数推导，默认开）。 */
  readingTime: boolean
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
  wordCount: string
  /** 阅读时长；`{count}` = 分钟。 */
  readingTime: string
  /** 更新日期；`{date}` = 已格式化的更新日。 */
  updatedOn: string
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
  /** 复制本页链接（文末动作条）。 */
  copyLink: string
  /** 分享本页（系统分享面板，不支持时不渲染按钮）。 */
  share: string

  // ---------- 移动端专属交互 ----------
  /** 打开导航抽屉（汉堡按钮的无障碍名）。 */
  openMenu: string
  /** 关闭导航抽屉。 */
  closeMenu: string
  /** 抽屉标题。 */
  menuTitle: string
  /** 底部操作栏：回到顶部。 */
  backToTop: string
  /** 底部操作栏：打开本页目录。 */
  openToc: string
  /** 关闭本页目录浮层。与 `closeMenu` 区分：那个说的是导航抽屉。 */
  closeToc: string
  /** 抽屉里导航列表的地标名，避免与抽屉 dialog 的 aria-label 重名。 */
  drawerNav: string
  /** 搜索入口。 */
  search: string
  /** 搜索框占位符。 */
  searchPlaceholder: string
  /** 搜索无结果。 */
  searchEmpty: string
  /** 搜索提示（输入几个字开始）。 */
  searchHint: string
  /** 搜索结果的计数。 */
  searchResults: string
  /** 搜索结果导航提示。 */
  searchNavigate: string
  /** 底部操作栏：首页。 */
  navHome: string
  /** 底部操作栏：文章列表。 */
  navPosts: string
  /**
   * 单数形式。中文不分单复数，`zh-cn.ts` 里与复数填同一句；
   * 英文必须区分（否则会出现「1 posts」「1 tags」）。
   */
  termCountOne: string
  taxonomyOverviewOne: string
  /**
   * 时间线年份分组后面的数量。
   *
   * 只有一个裸数字（`2026  1`）读者不知道 1 是什么，必须带单位；
   * 中文「{count} 篇」/英文「{count} posts」。
   */
  yearCount: string
  /** 单数形式；中文与复数同句，英文必须区分（否则「1 posts」）。 */
  yearCountOne: string

  // ---------- 图片查看器 ----------
  /** 查看器的无障碍名（dialog 的 aria-label）。 */
  imageViewer: string
  /** 关闭查看器。 */
  imageViewerClose: string
  /** 上一张。 */
  imageViewerPrevious: string
  /** 下一张。 */
  imageViewerNext: string
  /** 放大。 */
  imageViewerZoomIn: string
  /** 缩小。 */
  imageViewerZoomOut: string
  /** 实际大小 1:1（`1` 键）。 */
  imageViewerActualSize: string
  /** 下载原图。 */
  imageViewerDownload: string
  /**
   * 位置播报：`第 {current} 张，共 {total} 张`。
   * 拆成两个键是因为中英标点不同（同 `termCountOne` 的单复数先例）。
   */
  imageViewerPosition: string
  /** 位置播报 + alt 文案。 */
  imageViewerPositionWithAlt: string
  /** 缩略图条的无障碍名。 */
  imageViewerThumbs: string
  /** 加载中提示。 */
  imageViewerLoading: string
  /** 加载失败提示。 */
  imageViewerFailed: string
  /** 重试。 */
  imageViewerRetry: string
  /** 在新标签页打开原图（失败态兜底）。 */
  imageViewerOpenOriginal: string
  /** 键盘提示。 */
  imageViewerHint: string

  // ---------- 链接悬浮预览卡 ----------
  /** GitHub 元信息：今天有推送。 */
  linkPreviewUpdatedToday: string
  /** GitHub 元信息：昨天有推送。 */
  linkPreviewUpdatedYesterday: string
  /** GitHub 元信息：N 天前有推送（`{count}` = 天数）。 */
  linkPreviewUpdatedDays: string
  /** GitHub 元信息：N 个月前有推送（`{count}` = 月数）。 */
  linkPreviewUpdatedMonths: string
  /** GitHub 元信息：N 年前有推送（`{count}` = 年数）。 */
  linkPreviewUpdatedYears: string

  // ---------- 构建期嵌入块（:::github 等）的运行期增强 ----------
  /** 仓库卡元信息：今天有推送。 */
  embedUpdatedToday: string
  /** 仓库卡元信息：昨天有推送。 */
  embedUpdatedYesterday: string
  /** 仓库卡元信息：N 天前推送（`{count}` = 天数）。 */
  embedUpdatedDays: string
  /** 仓库卡元信息：N 个月前推送（`{count}` = 月数）。 */
  embedUpdatedMonths: string
  /** 仓库卡元信息：N 年前推送（`{count}` = 年数）。 */
  embedUpdatedYears: string
}

/** 语言元信息。 */
export interface LocaleMeta {
  /** 浏览器 `<html lang>`。 */
  lang: string
  /** 下拉菜单里的显示名。 */
  label: string
  /** 站点标题。 */
  title: string
  /** 站点描述。 */
  description: string
  /** 该语言的展示时区（日期格式化与 RSS 用）。 */
  timeZone: string
}
