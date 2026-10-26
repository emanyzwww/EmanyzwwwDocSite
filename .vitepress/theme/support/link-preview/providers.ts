/**
 * 链接预览的 provider 注册表。
 *
 * ## 新增一种链接类型（这就是「注册机制」的用法）
 *
 * 1. 如果是新的 URL 家族：在本文件写一个 `LinkProvider` 并加进
 *    `createProviders` 的返回数组（顺序即优先级，先注册先匹配）；
 * 2. **需要浏览器 fetch 第三方 API 时，先确认对方返回 CORS 头**
 *    （浏览器 F12 → Network → 看响应有没有 `Access-Control-Allow-Origin`）。
 *    没有 CORS 的接口（如 bilibili 的 web 接口会 403）在纯静态站上
 *    无解，只能走同源代理，或像 bilibili 现在这样降级成域名卡；
 * 3. 确认要走 fetch 的，同步在 `config.ts` 的 CSP `connect-src` 里加白名单
 *    —— 没加的话请求被静默拦截，表现为永远降级；
 *
 * ## 依赖注入（为什么 createProviders 要带参数）
 *
 * provider 的数据源里有两个「只能在组件 setup 期间创建」的东西：
 * `usePosts()`（内部 `useData()` → `inject()`）和 `useI18n()`。
 * 悬浮回调运行时早已离开 setup 上下文，那时再调 `inject` 会抛错。
 * 所以由 `PageShell` 在 setup 里调用 `createProviders({ posts, messages })`，
 * 把**响应式引用**闭包捕获进 provider —— fetch 时只读 `.value`，永远合法。
 *
 * ## 通用约定
 *
 * - **fetch 必须自带超时**（`fetchWithTimeout`）：悬浮卡不能让人等超过 4s；
 * - 拿不到就 `null`：调用方降级成 `fallbackSite` 域名卡，不打断阅读；
 * - 顺序即优先级：站内 → GitHub → bilibili；
 * - **没有通用外链兜底**（作者拍板）：域名卡信息量为零且观感差，
 *   不认识的链接悬浮不弹卡，比弹出一张「example.com」更有敬意。
 */

import { withBase } from 'vitepress'
import type { ComputedRef } from 'vue'

import type { Messages, PostSummary } from '../../../types'
import { format } from '../../i18n'
import type { LinkProvider } from './core'
import { compactNumber, fallbackPreview, parseBilibiliVideo, parseGitHubRepo } from './core'

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

/** createProviders 的注入参数（详见文件头「依赖注入」）。 */
export interface ProviderDeps {
  /** 当前语言的全部文章（`usePosts()` 的返回值，setup 期间捕获）。 */
  posts: ComputedRef<PostSummary[]>
  /** 当前语言的文案表（`useI18n()` 的 `m`，setup 期间捕获）。 */
  messages: ComputedRef<Messages>
}

/* ------------------------------------------------------------------ *
 * 站内文章（零网络：数据加载器已内联进客户端）
 * ------------------------------------------------------------------ */

/** 站内文章 provider。数据来自 `posts.data.ts`，悬浮即出、无 CSP / 隐私问题。 */
function createInternalProvider(deps: ProviderDeps): LinkProvider {
  return {
    id: 'internal',
    match(href) {
      try {
        return new URL(href, location.origin).origin === location.origin
      } catch {
        return false
      }
    },
    // 站内链接解析不到文章（如指向资源页）时收起卡片比域名卡更合理
    async fetch(href) {
      const path = new URL(href, location.origin).pathname.replace(/\/index\.html$/, '')
      const post = deps.posts.value.find((candidate) => {
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
function createGitHubProvider(deps: ProviderDeps): LinkProvider {
  return {
    id: 'github',
    // 限流（未认证 60 req/h/IP）或接口变更时降级，仍标明是 GitHub 站
    fallbackSite: 'GitHub',
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
      } | null
      if (!data?.full_name) return null

      const m = deps.messages.value
      const metaParts: string[] = []
      if (typeof data.stargazers_count === 'number') {
        metaParts.push(`★ ${compactNumber(data.stargazers_count)}`)
      }
      if (data.language) metaParts.push(data.language)
      if (data.pushed_at) {
        const relative = formatRelativeDays(data.pushed_at, m)
        if (relative) metaParts.push(relative)
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

/** 相对更新时间（i18n 键 `linkPreviewUpdated*`；解析失败返回空串不拼行）。 */
function formatRelativeDays(iso: string, m: Messages): string {
  const pushed = Date.parse(iso)
  if (!Number.isFinite(pushed)) return ''
  const days = Math.floor((Date.now() - pushed) / 86_400_000)
  if (days <= 0) return m.linkPreviewUpdatedToday
  if (days === 1) return m.linkPreviewUpdatedYesterday
  if (days < 30) return format(m.linkPreviewUpdatedDays, { count: days })
  if (days < 365) return format(m.linkPreviewUpdatedMonths, { count: Math.floor(days / 30) })
  return format(m.linkPreviewUpdatedYears, { count: Math.floor(days / 365) })
}

/* ------------------------------------------------------------------ *
 * bilibili 视频（降级为域名卡）
 * ------------------------------------------------------------------ */

/**
 * bilibili 视频 provider —— **当前不发请求**。
 *
 * bilibili 的 web 接口拒绝第三方站点的浏览器跨域请求（实测带 `Origin`
 * 头直接 403，且无 CORS 头），纯静态站无解：JSONP 会被 CSP `script-src`
 * 拦截，实时数据必须走同源代理（如 Cloudflare Pages Functions）。
 * 在代理落地之前，bilibili 链接显示「bilibili · ▶」域名卡——
 * 永远成功、不发请求；将来接入代理时，把 fetch 换成真实接口即可。
 */
function createBilibiliProvider(): LinkProvider {
  return {
    id: 'bilibili',
    fallbackSite: 'bilibili',
    match(href) {
      return parseBilibiliVideo(href) !== null
    },
    async fetch(href) {
      return fallbackPreview(href, 'bilibili')
    },
  }
}

/**
 * Provider 注册表。**顺序即优先级**（第一个 match 的赢）。
 *
 * 站内最先（本地数据秒出），GitHub / bilibili 按域匹配。
 * **故意没有通用外链兜底**：域名卡信息量为零且观感差（作者拍板），
 * 不认识的链接悬浮就不弹卡。要加新类型就再注册一个 provider。
 */
export function createProviders(deps: ProviderDeps): LinkProvider[] {
  return [createInternalProvider(deps), createGitHubProvider(deps), createBilibiliProvider()]
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
