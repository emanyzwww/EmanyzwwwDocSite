/**
 * 链接预览的公共类型与纯函数。
 *
 * 这个模块刻意**零依赖**（不 import vite / vitepress / vue / node 模块）：
 * - provider 匹配、缓存键、缓存过期判断是纯函数，单测直接跑（tests/ 约定）；
 * - 构建期若将来要做预取，也能复用同一份类型。
 *
 * ## 设计总览（为什么是「provider 注册表」）
 *
 * 链接类型会持续增加（GitHub、bilibili、…），每种类型的数据源与卡片
 * 版式都不同。把「URL → 数据」拆成可注册的 provider：
 *
 * ```text
 * matchProvider(href)  → 找到能处理这个 URL 的 provider（第一个命中的）
 * provider.fetch(href) → 返回 LinkPreview 数据（运行时 fetch + 缓存）
 * ```
 *
 * 新增一种链接 = 在 `providers.ts` 里注册一条，UI 与缓存完全不用动。
 */

/** 链接预览卡的数据。各 provider 负责把自己的 API 响应归一化成这个形状。 */
export interface LinkPreview {
  /** 标题（仓库名 / 视频标题 / 文章标题 / 页面标题）。 */
  title: string
  /** 描述（repo description / 视频简介 / 摘要）。可为空。 */
  description: string
  /** 元信息行（如 `★ 1.2k · TypeScript · Updated 3 days ago`），已格式化好的纯文本。 */
  meta?: string
  /** 站点名（卡片右上角小字，如 `GitHub` / `bilibili`）。 */
  site: string
  /** 图标名（`IconName` 子集里存在的才有效，未知名回退 `link`）。 */
  icon?: string
  /** 归一化后的链接（去跟踪参数、补协议）。 */
  url: string
}

/** 能处理某一类 URL 的 provider。 */
export interface LinkProvider {
  /** 稳定 id（缓存命名空间 + 日志排查用）。 */
  id: string
  /** 判断这个 href 是否归本 provider 处理。**必须纯同步**。 */
  match(href: string): boolean
  /**
   * 取数据。允许返回 `null`（拿不到时降级成通用卡，不报错）。
   * 实现方自带超时；失败抛错也行，调用方会兜底。
   */
  fetch(href: string): Promise<LinkPreview | null>
}

/**
 * 由 URL 推导缓存键。
 *
 * 统一规则：provider id + 归一化 URL。不同 provider 互不串键；
 * 同一 URL（含大小写差异、尾斜杠差异）只发一次请求。
 */
export function previewCacheKey(providerId: string, url: string): string {
  return `link-preview:${providerId}:${normalizeForCache(url)}`
}

/** 缓存归一化：小写 host、去尾斜杠、去常见跟踪参数。 */
export function normalizeForCache(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.protocol = 'https:'
    parsed.hash = ''
    for (const key of parsed.searchParams.keys()) {
      if (/^(utm_|spm|ref|ref_src|ref_ct|fbclid|gclid)/i.test(key)) {
        parsed.searchParams.delete(key)
      }
    }
    const search = parsed.searchParams.toString()
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/'
    return `${parsed.host.toLowerCase()}${pathname}${search ? `?${search}` : ''}`
  } catch {
    return url.trim().toLowerCase()
  }
}

/** 缓存条目（localStorage 序列化形状）。 */
export interface PreviewCacheEntry {
  /** 存入时间（毫秒时间戳）。 */
  at: number
  /** 数据。`null` 表示「请求过且拿不到」，同样要 TTL 内不再重试。 */
  data: LinkPreview | null
}

/**
 * 缓存是否仍然有效。
 *
 * @param entry 缓存条目
 * @param now 当前毫秒时间戳
 * @param ttl 有效期（毫秒）；负值 = 无缓存（永远视为过期）
 */
export function isCacheFresh(
  entry: PreviewCacheEntry | undefined | null,
  now: number,
  ttl: number,
): boolean {
  if (ttl < 0) return false
  if (!entry || typeof entry.at !== 'number') return false
  return now - entry.at >= 0 && now - entry.at < ttl
}

/**
 * 会话级缓存的 TTL（毫秒）。
 *
 * 用户反馈「实时网络请求更好，构建有时效性问题」——这里取**较短**的 TTL：
 * GitHub stars / 视频播放量这类数据以小时为粒度变化，24h 内的快照
 * 对「决定要不要点开」完全够用；重复悬浮零请求，也不会把读者浏览了
 * 哪些链接反复泄漏给第三方。
 */
export const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000

/** localStorage 的键前缀之外的命名空间（全站统一 `emanyzwww-` 前缀的惯例）。 */
export const PREVIEW_STORAGE_PREFIX = 'emanyzwww-link-preview'

/**
 * 提取 GitHub 仓库信息（owner/repo）。
 *
 * 接受的形态：
 * - `https://github.com/owner/repo`（仓库主页）
 * - 带任意子路径（issues、blob、pull…）——仍按 owner/repo 取仓库卡
 * - 忽略 `gist.github.com`、`github.com/owner`（个人主页不是仓库）
 *
 * 返回 `null` 表示不是仓库链接。
 */
export function parseGitHubRepo(url: string): { owner: string; repo: string } | null {
  try {
    const parsed = new URL(url)
    if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') return null
    const segments = parsed.pathname.split('/').filter(Boolean)
    // 至少 owner/repo 两段才是仓库；单段是个人主页，三段可能是 in/ 组织页等
    if (segments.length < 2) return null
    const [owner, repo] = segments as [string, string]
    // 保留页 / features 页等一级特殊路径不是仓库
    if (RESERVED_GITHUB_FIRST_SEGMENTS.has(owner.toLowerCase())) return null
    if (!owner || !repo) return null
    // repo 带 .git 后缀时归一化掉（clone 链接）
    return { owner, repo: repo.replace(/\.git$/, '') }
  } catch {
    return null
  }
}

/** github.com 下一级非仓库路径（`/features` 这类营销页与 `/orgs/` 等功能页）。 */
const RESERVED_GITHUB_FIRST_SEGMENTS = new Set([
  'features',
  'security',
  'pricing',
  'marketplace',
  'topics',
  'collections',
  'trending',
  'sponsors',
  'settings',
  'notifications',
  'explore',
  'about',
  'contact',
  'search',
  'orgs',
  'enterprises',
  'account',
])

/**
 * 提取 bilibili 视频信息（BV 号）。
 *
 * 接受 `www.bilibili.com/video/BVxxxx`（允许查询参数与短路径）。
 */
export function parseBilibiliVideo(url: string): { bvid: string } | null {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, '')
    if (host !== 'bilibili.com') return null
    const match = /^\/video\/(BV[0-9A-Za-z]+)/.exec(parsed.pathname)
    return match?.[1] ? { bvid: match[1] } : null
  } catch {
    return null
  }
}

/**
 * 数字缩写（1234 → 1.2k），GitHub stars / bilibili 播放量共用。
 */
export function compactNumber(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0'
  if (value < 1000) return String(Math.round(value))
  if (value < 1_000_000) {
    const k = value / 1000
    return `${k >= 100 ? Math.round(k) : Math.round(k * 10) / 10}k`
  }
  const m = value / 1_000_000
  return `${m >= 100 ? Math.round(m) : Math.round(m * 10) / 10}M`
}
