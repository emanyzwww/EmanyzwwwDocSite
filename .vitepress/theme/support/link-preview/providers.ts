/**
 * 链接预览的 provider 注册表。
 *
 * ## 新增一种链接类型（这就是「注册机制」的用法）
 *
 * 1. 如果是新的 URL 家族：在本文件写一个 `LinkProvider` 并加进 `PROVIDERS`；
 * 2. 需要新 API 域名时，同步在 `config.ts` 的 CSP `connect-src` 里加白名单；
 * 3. 数据形状归一化成 `LinkPreview`（core.ts），UI 不用动。
 *
 * ## 通用约定
 *
 * - **fetch 必须自带超时**（`fetchWithTimeout`）：悬浮卡不能让人等超过 4s；
 * - 拿不到就 `null`：调用方降级成「域名 + 链接」的通用卡，不打断阅读；
 * - 顺序即优先级：`PROVIDERS` 里先注册的先匹配（站内 → GitHub → bilibili → 通用）。
 */

import { withBase } from 'vitepress'

import { usePosts } from '../../composables/usePosts'
import { format, useI18n } from '../../i18n'
import type { LinkProvider } from './core'
import { compactNumber, parseBilibiliVideo, parseGitHubRepo } from './core'

/** fetch 超时（毫秒）。悬浮场景等待上限，超了就降级。 */
const FETCH_TIMEOUT_MS = 4000

/** 带 AbortController 超时的 fetch。失败 / 超时都返回 `null`。 */
async function fetchWithTimeout(
  url: string,
  headers?: Record<string, string>,
): Promise<unknown | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', ...headers },
    })
    if (!response.ok) return null
    return (await response.json()) as unknown
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/* ------------------------------------------------------------------ *
 * 站内文章（零网络：数据加载器已内联进客户端）
 * ------------------------------------------------------------------ */

/** 站内文章 provider。数据来自 `posts.data.ts`，悬浮即出、无 CSP / 隐私问题。 */
function createInternalProvider(): LinkProvider {
  return {
    id: 'internal',
    match(href) {
      try {
        const path = new URL(href, location.origin)
        return path.origin === location.origin
      } catch {
        return false
      }
    },
    async fetch(href) {
      const { posts } = usePosts()
      const path = new URL(href, location.origin).pathname.replace(/\/index\.html$/, '')
      const post = posts.value.find((candidate) => {
        // 数据里的 url 不含 base；比较时两边都归一化掉 base
        return withBase(candidate.url) === path || candidate.url === path
      })
      if (!post) return null
      return {
        title: post.title,
        description: post.summary,
        meta: post.dateText,
        site: '',
        url: href,
      }
    },
  }
}

/* ------------------------------------------------------------------ *
 * GitHub 仓库
 * ------------------------------------------------------------------ */

/** GitHub 仓库 provider。REST API 无需认证（60 req/h/IP，有 24h 缓存兜着够用）。 */
function createGitHubProvider(): LinkProvider {
  return {
    id: 'github',
    match(href) {
      return parseGitHubRepo(href) !== null
    },
    async fetch(href) {
      const repo = parseGitHubRepo(href)
      if (!repo) return null
      const data = (await fetchWithTimeout(
        `https://api.github.com/repos/${repo.owner}/${repo.repo}`,
      )) as {
        full_name?: string
        description?: string | null
        stargazers_count?: number
        language?: string | null
        pushed_at?: string
        homepage?: string | null
      } | null
      if (!data?.full_name) return null

      const metaParts: string[] = []
      if (typeof data.stargazers_count === 'number') {
        metaParts.push(`★ ${compactNumber(data.stargazers_count)}`)
      }
      if (data.language) metaParts.push(data.language)
      if (data.pushed_at) {
        metaParts.push(formatRelativeDays(data.pushed_at))
      }

      return {
        title: data.full_name,
        description: data.description ?? '',
        meta: metaParts.join(' · '),
        site: 'GitHub',
        icon: 'github',
        url: href,
      }
    },
  }
}

/** 「Updated N days ago」的极简相对时间（不引入 dayjs；i18n 由卡片层兜底成 dateText）。 */
function formatRelativeDays(iso: string): string {
  const pushed = Date.parse(iso)
  if (!Number.isFinite(pushed)) return ''
  const days = Math.floor((Date.now() - pushed) / 86_400_000)
  if (days <= 0) return 'updated today'
  if (days === 1) return 'updated yesterday'
  if (days < 30) return `updated ${days}d ago`
  if (days < 365) return `updated ${Math.floor(days / 30)}mo ago`
  return `updated ${Math.floor(days / 365)}y ago`
}

/* ------------------------------------------------------------------ *
 * bilibili 视频
 * ------------------------------------------------------------------ */

/** bilibili 视频 provider。公开的 web 接口，无需登录（有 24h 缓存兜着）。 */
function createBilibiliProvider(): LinkProvider {
  return {
    id: 'bilibili',
    match(href) {
      return parseBilibiliVideo(href) !== null
    },
    async fetch(href) {
      const video = parseBilibiliVideo(href)
      if (!video) return null
      const data = (await fetchWithTimeout(
        `https://api.bilibili.com/x/web-interface/view?bvid=${video.bvid}`,
      )) as {
        code?: number
        data?: {
          title?: string
          desc?: string
          owner?: { name?: string }
          stat?: { view?: number; like?: number }
        }
      } | null
      if (data?.code !== 0 || !data.data?.title) return null

      // 文案必须走 i18n（英文站不能串中文）；useI18n 依赖当前路由，fetch 时一定有
      const { m } = useI18n()
      const metaParts: string[] = []
      if (typeof data.data.stat?.view === 'number') {
        metaParts.push(
          format(m.value.linkPreviewViews, { count: compactNumber(data.data.stat.view) }),
        )
      }
      if (typeof data.data.stat?.like === 'number') {
        metaParts.push(
          format(m.value.linkPreviewLikes, { count: compactNumber(data.data.stat.like) }),
        )
      }

      return {
        title: data.data.title,
        description: data.data.desc ?? '',
        meta: metaParts.join(' · '),
        site: data.data.owner?.name ? `bilibili · ${data.data.owner.name}` : 'bilibili',
        icon: 'play',
        url: href,
      }
    },
  }
}

/* ------------------------------------------------------------------ *
 * 通用外链（兜底）
 * ------------------------------------------------------------------ */

/** 通用外链 provider。不发任何请求：只从 URL 本身推导（域名卡），永远成功。 */
function createExternalProvider(): LinkProvider {
  return {
    id: 'external',
    match() {
      // 兜底 provider：只处理 http(s) 外链；其它协议（mailto: 等）不弹卡
      return true
    },
    async fetch(href) {
      try {
        const parsed = new URL(href)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
        if (parsed.origin === location.origin) return null
        return {
          title: parsed.hostname.replace(/^www\./, ''),
          description: '',
          site: '',
          icon: 'globe',
          url: href,
        }
      } catch {
        return null
      }
    },
  }
}

/**
 * Provider 注册表。**顺序即优先级**（第一个 match 的赢）。
 *
 * 站内最先（本地数据秒出），GitHub / bilibili 按域匹配，
 * 通用外链永远兜底。
 */
export function createProviders(): LinkProvider[] {
  return [
    createInternalProvider(),
    createGitHubProvider(),
    createBilibiliProvider(),
    createExternalProvider(),
  ]
}

/** 由 href 找到第一个匹配的 provider；都不匹配返回 `null`。 */
export function matchProvider(providers: LinkProvider[], href: string): LinkProvider | null {
  for (const provider of providers) {
    try {
      if (provider.match(href)) return provider
    } catch {
      // 单个 provider 的 match 抛错不阻断遍历
    }
  }
  return null
}
