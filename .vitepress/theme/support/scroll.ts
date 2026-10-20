/**
 * 滚动监听工具。
 *
 * 全站只有这一处监听 `scroll` / `resize`，并在这里统一做帧节流：
 * - 多个消费者（进度条、目录高亮）共用同一次订阅，不会各自 addEventListener；
 * - 用 `requestAnimationFrame` 合并同一帧内的多次滚动事件；
 * - 若环境不支持或 rAF 被节流（如某些无头浏览器），退化为 `setTimeout`，
 *   保证回调最终一定执行，而不是永远等不到帧。
 */

import { onBeforeUnmount, onMounted } from 'vue'

type ScrollHandler = () => void

const handlers = new Set<ScrollHandler>()
let frame = 0
let timer = 0
let listening = false

/** 执行所有回调（每帧一次）。 */
function flush(): void {
  frame = 0
  if (timer) {
    clearTimeout(timer)
    timer = 0
  }
  for (const handler of handlers) handler()
}

/** 调度一次刷新：优先 rAF，同时挂一个超时兜底。 */
function schedule(): void {
  if (frame || timer) return

  if (typeof requestAnimationFrame === 'function') {
    frame = requestAnimationFrame(flush)
    // 兜底：rAF 若因标签页隐藏或环境限制不触发，超时后仍然刷新
    timer = window.setTimeout(flush, 100)
    return
  }

  timer = window.setTimeout(flush, 16)
}

/** 共享的滚动回调列表（模块级单例）。 */
function ensureListening(): void {
  if (listening) return
  listening = true
  window.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', schedule)
}

/**
 * 订阅滚动与尺寸变化。
 *
 * 回调在挂载后立即执行一次，因此不需要调用方自己算初始值。
 * 在组件卸载时自动取消订阅，调用方无需清理。
 */
export function useScrollEffect(handler: ScrollHandler): void {
  onMounted(() => {
    ensureListening()
    handlers.add(handler)
    handler()
  })

  onBeforeUnmount(() => {
    handlers.delete(handler)
  })
}

/** 直接取滚动位置（避免依赖 `window.scrollY` 在 iframe 里的兼容差异）。 */
export function scrollTop(): number {
  return window.scrollY || document.documentElement.scrollTop || 0
}
