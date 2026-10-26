/**
 * 构建期嵌入块的**运行期增强**。
 *
 * ## 分工
 *
 * ```text
 * 构建期（同步、零网络）  :::github vuejs/core  →  一条真链接 <a href="…">vuejs/core</a>
 * 运行期（异步、可失败）  读到 data-embed  →  补描述/★/语言 → 换成卡片版式
 *                         拿不到数据       →  什么都不做，保留那条链接
 * ```
 *
 * 这就是「基线可用 + 渐进增强」。它的好处不是"更酷"，而是**失败路径为空**：
 * 没有 JS、断网、GitHub 限流、接口改版，读者看到的都是同一条能点的链接，
 * 而不是一个空盒子或一句"加载失败"。
 *
 * ## 三条实现纪律
 *
 * 1. **只加不改结构**：一切改动都发生在 `.embed` 容器内部，容器本身与它所在的
 *    位置永远不动。这是为了避免 SSR 与客户端渲染的分歧（hydration mismatch）——
 *    静态 HTML 是 Vue 的 vnode 来源，我们动它的结构就等于骗 Vue。
 *    > 具体教训：旧卡片把 `<p>` 放进 `<a>` 里，浏览器解析时把一张卡拆成三个
 *    > 链接，Vue 立刻报 hydration mismatch。
 * 2. **懒加载**：滚动接近才请求。一屏看十张卡不该发十次请求。
 * 3. **只请求一次、按 URL 去重**：同一仓库在一页出现多次共用一个 Promise；
 *    结果进 `localStorage`（TTL 24h），跨页、跨会话都不重复请求。
 */

import { compactNumber, daysSince, parseGitHubRepo } from '../../shared/github'
import type { Messages } from '../../types'
import { format } from '../i18n'

/** 缓存 TTL（毫秒）。与悬浮预览卡同档：卡片信息以小时为粒度变化。 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

/** `localStorage` 键前缀（全站统一 `emanyzwww-` 约定）。 */
const STORAGE_PREFIX = 'emanyzwww-embed'

/** 单个请求超时（毫秒）。卡片不值得让读者等。 */
const FETCH_TIMEOUT_MS = 5000

/** 距离进入视口多远开始请求（px）。提前一屏，滚到时数据已就绪。 */
const PRELOAD_MARGIN = '200px'

/** GitHub API 返回里我们用到的字段。 */
interface RepoApiData {
  full_name?: string
  description?: string | null
  stargazers_count?: number
  language?: string | null
  pushed_at?: string
}

/** 一张卡要展示的数据（已归一化，与 API 解耦）。 */
export interface RepoCardData {
  fullName: string
  description: string
  stars: number
  language: string
  pushedAt: string
}

/** 缓存条目（`null` 表示「请求过但拿不到」，TTL 内不再重试）。 */
interface CacheEntry {
  at: number
  data: RepoCardData | null
}

/* ------------------------------------------------------------------ *
 * 缓存
 * ------------------------------------------------------------------ */

/** 会话内缓存：命中零解析。 */
const memory = new Map<string, CacheEntry>()

/** 进行中的请求：同一 URL 并发只发一次。 */
const inflight = new Map<string, Promise<RepoCardData | null>>()

function cacheKey(fullName: string): string {
  return `${STORAGE_PREFIX}:${fullName.toLowerCase()}`
}

function isFresh(entry: CacheEntry | null | undefined, now: number): boolean {
  if (!entry || typeof entry.at !== 'number') return false
  return now - entry.at >= 0 && now - entry.at < CACHE_TTL_MS
}

function readStorage(fullName: string): CacheEntry | null {
  try {
    const raw = localStorage.getItem(cacheKey(fullName))
    return raw ? (JSON.parse(raw) as CacheEntry) : null
  } catch {
    return null
  }
}

function writeStorage(fullName: string, entry: CacheEntry): void {
  try {
    localStorage.setItem(cacheKey(fullName), JSON.stringify(entry))
  } catch {
    // 隐私模式 / 配额满：缓存只是加速，跳过即可
  }
}

/* ------------------------------------------------------------------ *
 * 取数
 * ------------------------------------------------------------------ */

/** 从 API 响应归一化；关键字段缺失视为失败。 */
function toCardData(data: RepoApiData): RepoCardData | null {
  if (!data.full_name) return null
  return {
    fullName: data.full_name,
    description: typeof data.description === 'string' ? data.description : '',
    stars: typeof data.stargazers_count === 'number' ? data.stargazers_count : 0,
    language: typeof data.language === 'string' ? data.language : '',
    pushedAt: typeof data.pushed_at === 'string' ? data.pushed_at : '',
  }
}

/** 带超时的 fetch。失败/超时/非 2xx 都返回 `null`，**不抛错**。 */
async function requestRepo(fullName: string): Promise<RepoCardData | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(`https://api.github.com/repos/${fullName}`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    })
    if (!response.ok) return null
    return toCardData((await response.json()) as RepoApiData)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** 取一张卡的数据：内存 → localStorage → 网络。 */
async function loadRepo(fullName: string): Promise<RepoCardData | null> {
  const now = Date.now()

  const memo = memory.get(fullName)
  if (isFresh(memo, now)) return memo?.data ?? null

  const stored = readStorage(fullName)
  if (isFresh(stored, now)) {
    memory.set(fullName, stored as CacheEntry)
    return (stored as CacheEntry).data
  }

  const existing = inflight.get(fullName)
  if (existing) return existing

  const request = requestRepo(fullName).then((data) => {
    const entry: CacheEntry = { at: Date.now(), data }
    memory.set(fullName, entry)
    writeStorage(fullName, entry)
    return data
  })

  inflight.set(fullName, request)
  try {
    return await request
  } finally {
    inflight.delete(fullName)
  }
}

/* ------------------------------------------------------------------ *
 * 渲染（只加不改）
 * ------------------------------------------------------------------ */

/** 创建元素的小工具，避免到处写 `document.createElement`。 */
function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** 元信息行文案（`★ 54.9k · TypeScript · 今天更新`）。 */
function metaParts(data: RepoCardData, m: Messages): string[] {
  const parts: string[] = []
  if (data.stars > 0) parts.push(`★ ${compactNumber(data.stars)}`)
  if (data.language) parts.push(data.language)

  if (data.pushedAt) {
    const days = daysSince(data.pushedAt, Date.now())
    if (days === 0) parts.push(m.embedUpdatedToday)
    else if (days === 1) parts.push(m.embedUpdatedYesterday)
    else if (days !== null && days < 30) parts.push(format(m.embedUpdatedDays, { count: days }))
    else if (days !== null && days < 365) {
      parts.push(format(m.embedUpdatedMonths, { count: Math.floor(days / 30) }))
    } else if (days !== null) {
      parts.push(format(m.embedUpdatedYears, { count: Math.floor(days / 365) }))
    }
  }

  return parts
}

/**
 * 把一张 `.embed--github` 升级成卡片版式。
 *
 * **只往 `.embed` 里追加节点**，不动容器本身，也不动外面的结构。
 * 重复调用是安全的（已经有 `is-enhanced` 就跳过）。
 */
function enhanceRepoCard(root: HTMLElement, data: RepoCardData, m: Messages): void {
  if (root.dataset.enhanced === 'true') return

  const link = root.querySelector<HTMLAnchorElement>('.embed__link')
  if (!link) return

  // 描述
  if (data.description) {
    // 放在链接内部：整卡仍是同一个可点区域，点击语义不变
    link.append(element('span', 'embed__desc', data.description))
  }

  // 元信息
  const parts = metaParts(data, m)
  if (parts.length > 0) {
    link.append(element('span', 'embed__meta', parts.join(' · ')))
  }

  root.dataset.enhanced = 'true'
  root.classList.add('is-enhanced')
}

/* ------------------------------------------------------------------ *
 * 调度
 * ------------------------------------------------------------------ */

/** 一个页面的增强任务（可整体销毁，用于路由切换）。 */
export class EmbedEnhancer {
  private readonly observer: IntersectionObserver | null
  private readonly m: () => Messages
  private disposed = false

  constructor(messages: () => Messages) {
    this.m = messages

    /*
     * 不支持 IntersectionObserver 的环境（极老浏览器、部分测试环境）
     * 退化成「立即全部加载」——宁可多几个请求，也不要卡片永远停在链接态。
     */
    if (typeof IntersectionObserver === 'undefined') {
      this.observer = null
      return
    }

    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const root = entry.target as HTMLElement
          this.observer?.unobserve(root)
          void this.upgrade(root)
        }
      },
      { rootMargin: PRELOAD_MARGIN },
    )
  }

  /** 扫描一份 DOM（首次挂载与路由切换后都要调）。 */
  scan(scope: ParentNode): void {
    if (this.disposed) return

    const cards = scope.querySelectorAll<HTMLElement>('.embed--github[data-target]')
    for (const card of cards) {
      // 已增强过（客户端路由没换节点时会出现）就不再排队
      if (card.dataset.enhanced === 'true') continue
      if (this.observer) this.observer.observe(card)
      else void this.upgrade(card)
    }
  }

  /** 实际取数并渲染。所有失败路径都静默——基线链接本来就能用。 */
  private async upgrade(root: HTMLElement): Promise<void> {
    const target = root.dataset.target
    if (!target) return

    // 允许作者写完整链接，归一化成 owner/repo
    const fullName = parseGitHubRepo(`https://github.com/${target}`)
    if (!fullName) return

    const data = await loadRepo(`${fullName.owner}/${fullName.repo}`)
    if (this.disposed || !data) return

    enhanceRepoCard(root, data, this.m())
  }

  /** 销毁（路由切换时调用）：停止观察，不再改 DOM。 */
  dispose(): void {
    this.disposed = true
    this.observer?.disconnect()
  }
}
