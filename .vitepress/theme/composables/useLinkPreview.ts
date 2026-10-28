/**
 * 链接预览状态机（模块级单例）。
 *
 * ## 为什么是单例
 *
 * 与 `useImageViewer` 同一理由：悬浮入口是正文里构建期生成的 `<a>`
 * （事件委托装在 `PageShell`），卡片组件是 Teleport 到 body 的单份 DOM ——
 * 两边必须看到同一份状态。
 *
 * ## 交互时序
 *
 * ```text
 * mouseover 链接 ── 300ms 延迟 ──> 显示卡片（peek / 缓存命中则直接出，无骨架）
 *      │                              │
 *      │ 移出（任何时刻取消）          │ fetch 未完成则先显示骨架
 *      ▼                              ▼
 *   取消/收起 <──────── 200ms 后收起（留出跨入卡片的时间）
 * ```
 *
 * - **300ms 进入延迟**：扫过链接（如沿一行文字移动鼠标）不弹卡；
 * - **200ms 离开延迟**：鼠标从链接移进卡片本身不闪烁；
 * - 键盘 `focusin` 同样触发（可访问性），延迟更短（150ms）；
 * - **sync peek**：数据在客户端的 provider（站内文章）会先同步表态 ——
 *   确定没有卡就**什么都不发生**，不亮骨架不闪（见 `hoverLink` 里的说明）。
 */

import { readonly, ref } from 'vue'

import type { LinkPreview } from '../support/link-preview/core'
import {
  fallbackPreview,
  isCacheFresh,
  isPreviewableHref,
  matchProvider,
  PREVIEW_STORAGE_PREFIX,
  PREVIEW_TTL_MS,
  previewCacheKey,
  type LinkProvider,
  type PreviewCacheEntry,
} from '../support/link-preview/core'

/* ------------------------------------------------------------------ *
 * 单例状态
 * ------------------------------------------------------------------ */

/** 当前展示的预览数据；`null` = 骨架态（fetch 中）。 */
const preview = ref<LinkPreview | null>(null)
/** 卡片是否显示。 */
const visible = ref(false)
/** fetch 进行中（决定骨架态）。 */
const pending = ref(false)
/** 卡片锚点（触发链接的屏幕矩形）。 */
const anchor = ref<{ x: number; y: number; width: number; height: number } | null>(null)

/** 进入/离开延迟的定时器。 */
let enterTimer: ReturnType<typeof setTimeout> | null = null
let leaveTimer: ReturnType<typeof setTimeout> | null = null

/**
 * provider 列表。
 *
 * 必须由 `PageShell` 在 **setup 期间**调用 `setLinkPreviewProviders`
 * 注入（内部要捕获 `usePosts` / `useI18n` 的响应式引用，见 providers.ts
 * 「依赖注入」）。注入前悬浮直接忽略 —— 不会报错，只是没卡片。
 */
let providers: LinkProvider[] | null = null

/** 本会话内的内存缓存（localStorage 之上的一层，命中零解析）。 */
const memoryCache = new Map<string, PreviewCacheEntry>()

/* ------------------------------------------------------------------ *
 * localStorage 缓存（跨会话）
 * ------------------------------------------------------------------ */

function readStorage(key: string): PreviewCacheEntry | null {
  try {
    const raw = localStorage.getItem(`${PREVIEW_STORAGE_PREFIX}:${key}`)
    return raw ? (JSON.parse(raw) as PreviewCacheEntry) : null
  } catch {
    return null
  }
}

function writeStorage(key: string, entry: PreviewCacheEntry): void {
  try {
    localStorage.setItem(`${PREVIEW_STORAGE_PREFIX}:${key}`, JSON.stringify(entry))
  } catch {
    // 隐私模式 / 配额满：静默跳过，缓存只是加速
  }
}

/* ------------------------------------------------------------------ *
 * 取数（缓存 → 内存 → 网络）
 * ------------------------------------------------------------------ */

/** 进行中的请求去重：同一 key 并发悬浮只发一次。 */
const inflight = new Map<string, Promise<LinkPreview | null>>()

async function loadPreview(provider: LinkProvider, href: string): Promise<LinkPreview | null> {
  const key = previewCacheKey(provider.id, href)
  const now = Date.now()

  // ① 内存
  const memo = memoryCache.get(key)
  if (memo && isCacheFresh(memo, now, PREVIEW_TTL_MS)) return memo.data

  // ② localStorage
  const stored = readStorage(key)
  if (stored && isCacheFresh(stored, now, PREVIEW_TTL_MS)) {
    memoryCache.set(key, stored)
    return stored.data
  }

  // ③ 网络去重
  const existing = inflight.get(key)
  if (existing) return existing

  const request = provider
    .fetch(href)
    .then((data) => {
      const entry: PreviewCacheEntry = { at: Date.now(), data }
      memoryCache.set(key, entry)
      writeStorage(key, entry)
      return data
    })
    .catch(() => null)
    .finally(() => {
      inflight.delete(key)
    })
  inflight.set(key, request)
  return request
}

/* ------------------------------------------------------------------ *
 * 动作
 * ------------------------------------------------------------------ */

function clearTimers(): void {
  if (enterTimer !== null) {
    clearTimeout(enterTimer)
    enterTimer = null
  }
  if (leaveTimer !== null) {
    clearTimeout(leaveTimer)
    leaveTimer = null
  }
}

/** 链接悬浮（mouseover 委托调用）。 */
export function hoverLink(link: HTMLAnchorElement, delayMs = 300): void {
  /*
   * 用 `.href`（浏览器的 IDL 属性）而不是 `getAttribute('href')`：
   * 它一定是**解析好的绝对 URL**。相对路径原样传下去会让缓存键与
   * `fallbackPreview` 各算各的（`new URL('./x.png')` 直接抛错）。
   */
  const href = link.href
  if (!isPreviewableHref(href)) return // 兜底：PageShell 已先筛过一遍

  const provider = matchProvider(providers ?? [], href)
  if (!provider) return

  /*
   * 同步「先看一眼」。
   *
   * - `null` = 数据源确定没有这张卡（站内链接指向 .png、/pages/tags/ 之类）：
   *   **直接返回，连定时器都不排**。历史 bug 就出在这里：以前一律先排定时器、
   *   开卡、亮骨架，等 fetch 回来才发现什么都没有 —— 读者看到卡片闪一下。
   * - `undefined` = 无法预判，照常走 fetch + 骨架。
   * - 数据 = 延迟结束直接渲染，连骨架都省了（骨架只该属于真的要等网络的卡）。
   */
  let known: LinkPreview | null | undefined
  try {
    known = provider.peek?.(href)
  } catch {
    known = undefined
  }
  if (known === null) return

  /*
   * 到了这里才动定时器：这是一次真正的「进入」，要取消上一次的进入/离开。
   *
   * 反过来，上面那几处提前返回**不能**清定时器：鼠标从已出卡的链接 A 移到
   * 「确定没有卡」的链接 B 时，`unhoverLink` 排下的 200ms 离开定时器必须活到
   * 触发 —— 清掉它，卡片就会永远挂在屏幕上。
   */
  clearTimers()
  anchor.value = link.getBoundingClientRect()
  enterTimer = setTimeout(() => {
    /*
     * 定时器已触发：必须清掉句柄再打开。否则 enterTimer 永远非空，
     * openFor 里的「过期守卫」会把每个 fetch 结果都当成过期丢弃 ——
     * 卡片就会永远停在骨架屏（本文件历史上真实发生过这个 bug）。
     */
    enterTimer = null
    void openFor(provider, href, known)
  }, delayMs)
}

/** 键盘聚焦（focusin 委托调用）。延迟更短：Tab 导航是有意为之。 */
export function focusLink(link: HTMLAnchorElement): void {
  hoverLink(link, 150)
}

async function openFor(
  provider: LinkProvider,
  href: string,
  known?: LinkPreview | null,
): Promise<void> {
  visible.value = true

  // 数据现成（provider.peek 命中）：直接渲染，不进骨架态
  if (known) {
    pending.value = false
    preview.value = known
    return
  }

  pending.value = true
  preview.value = null

  const data = await loadPreview(provider, href)
  // 悬浮目标已经换了 / 卡片已经收起：丢弃过期结果
  if (enterTimer !== null || !visible.value) return
  pending.value = false
  if (data) {
    preview.value = data
    return
  }
  /*
   * 专用 provider 拿不到数据（限流 / CORS / 接口变更）：
   * 用 provider 声明的 fallbackSite 降级成域名兜底卡，而不是让卡片
   * 两个渲染分支都不命中、停在一张什么都看不见的空盒子上。
   * 连域名卡都构造不出来（非 http(s)）就直接收起。
   */
  preview.value = fallbackPreview(href, provider.fallbackSite ?? '')
  if (preview.value === null) visible.value = false
}

/** 链接移出（mouseout 委托调用）。 */
export function unhoverLink(): void {
  clearTimers()
  // 200ms 宽限：给「从链接移进卡片」留时间
  leaveTimer = setTimeout(() => {
    visible.value = false
    pending.value = false
    preview.value = null
    anchor.value = null
  }, 200)
}

/** 鼠标进入卡片（取消收起）。 */
export function hoverCard(): void {
  clearTimers()
}

/** 滚动时收起（锚点矩形已失效）。 */
export function dismiss(): void {
  clearTimers()
  visible.value = false
  pending.value = false
  preview.value = null
  anchor.value = null
}

/** 供单测：注入 provider 列表（避免依赖 app 上下文）。 */
export function setLinkPreviewProviders(list: LinkProvider[]): void {
  providers = list
}

/** 供组件使用。 */
export function useLinkPreview() {
  return {
    preview: readonly(preview),
    visible: readonly(visible),
    pending: readonly(pending),
    anchor: readonly(anchor),
    hoverLink,
    focusLink,
    unhoverLink,
    hoverCard,
    dismiss,
  }
}
