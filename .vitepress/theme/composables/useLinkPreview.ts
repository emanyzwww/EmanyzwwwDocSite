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
 * mouseover 链接 ── 300ms 延迟 ──> 显示卡片（命中缓存则立即）
 *      │                              │
 *      │ 移出（任何时刻取消）          │ fetch 未完成则先显示骨架
 *      ▼                              ▼
 *   取消/收起 <──────── 200ms 后收起（留出跨入卡片的时间）
 * ```
 *
 * - **300ms 进入延迟**：扫过链接（如沿一行文字移动鼠标）不弹卡；
 * - **200ms 离开延迟**：鼠标从链接移进卡片本身不闪烁；
 * - 键盘 `focusin` 同样触发（可访问性），延迟更短（150ms）。
 */

import { readonly, ref } from 'vue'

import type { LinkPreview } from '../support/link-preview/core'
import {
  isCacheFresh,
  PREVIEW_STORAGE_PREFIX,
  PREVIEW_TTL_MS,
  previewCacheKey,
  type LinkProvider,
  type PreviewCacheEntry,
} from '../support/link-preview/core'
import { matchProvider, createProviders } from '../support/link-preview/providers'

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

/** provider 列表（懒建：首次悬浮才创建，其中 usePosts 需要 app 上下文）。 */
let providers: LinkProvider[] | null = null
function providersOf(): LinkProvider[] {
  providers ??= createProviders()
  return providers
}

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
  const href = link.getAttribute('href')
  if (!href) return

  const provider = matchProvider(providersOf(), href)
  if (!provider) return

  clearTimers()
  anchor.value = link.getBoundingClientRect()
  enterTimer = setTimeout(() => {
    void openFor(provider, href)
  }, delayMs)
}

/** 键盘聚焦（focusin 委托调用）。延迟更短：Tab 导航是有意为之。 */
export function focusLink(link: HTMLAnchorElement): void {
  hoverLink(link, 150)
}

async function openFor(provider: LinkProvider, href: string): Promise<void> {
  visible.value = true
  pending.value = true
  preview.value = null

  const data = await loadPreview(provider, href)
  // 悬浮目标已经换了 / 卡片已经收起：丢弃过期结果
  if (enterTimer !== null || !visible.value) return
  pending.value = false
  preview.value = data
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

/** 供单测：重置全部状态与缓存。 */
export function resetLinkPreviewState(): void {
  clearTimers()
  preview.value = null
  visible.value = false
  pending.value = false
  anchor.value = null
  memoryCache.clear()
  inflight.clear()
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
