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
  /**
   * 降级域名卡上显示的站点名（如 `GitHub`）。缺省 = 只显示域名。
   * provider fetch 失败时，调用方用它让降级卡至少标明「这是哪类站」。
   */
  fallbackSite?: string
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
 * 提取 GitHub 仓库信息（owner/repo）与数字缩写。
 *
 * 实现已经收敛到 `shared/github.ts`（构建期与运行期共用的纯函数层），
 * 这里只再导出一次：本模块的调用方（`providers.ts` 与单测）不需要改 import 路径，
 * 也保证仓库卡与悬浮卡用的是**同一套**解析与数字格式，不会各显示一个数。
 */
export { compactNumber, parseGitHubRepo } from '../../../shared/github'

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
 * 由 URL 构造域名兜底卡。
 *
 * 专用 provider（GitHub / bilibili…）拿不到数据时（限流、CORS、接口变更），
 * 调用方用它兜底 —— 保证悬浮卡**永不空白**。纯函数，单测直接覆盖。
 *
 * `site` 可传专用 provider 的站点名（如 `GitHub`），让降级卡至少标明
 * 「这是哪类站」；传空则只显示域名。非 http(s) 或解析失败返回 `null`
 * （调用方此时应直接收起卡片，而不是显示一张空卡）。
 */
export function fallbackPreview(url: string, site = ''): LinkPreview | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return {
      title: parsed.hostname.replace(/^www\./, ''),
      description: '',
      site,
      icon: 'globe',
      url,
    }
  } catch {
    return null
  }
}
