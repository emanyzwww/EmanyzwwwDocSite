/**
 * 视口底边补偿。
 *
 * 解决的问题：`position: fixed; bottom: 0` 贴的是 **layout viewport**。
 * 移动浏览器（iOS Safari、Chrome Android）收起或展开地址栏 / 底部工具栏时，
 * layout viewport 不会逐帧变化，只有 **visual viewport** 变了。
 * 结果是固定底栏在动画期间「钉在原地」，等浏览器重算完 layout viewport
 * 才「跳」上来 —— 用户感知就是「手指往上滑了，但底栏过一会才浮上来」。
 *
 * 做法：读 `window.visualViewport`，把它与 layout viewport 的底边差值
 * 写进 `--vv-gap`（定义见 `styles/tokens.css`），让 CSS 用
 * `max(--vv-gap, safe-area-inset-bottom)` 把底栏推上去。
 *
 * 为什么用 max 而不是相加：刘海屏手势条与浏览器工具栏在物理上不会同时遮挡
 * 同一块像素（工具栏可见时它自己就垫在最底部）。相加会把底栏顶到很高。
 *
 * 兼容与降级：
 * - 不支持 `visualViewport` 的浏览器（老 Safari、部分内嵌 WebView）→
 *   什么都不做，`--vv-gap` 保持默认 0，退化成「贴 layout 底」的旧行为；
 * - `resize` 与 `scroll` 都要监听：iOS 在工具栏动画期间只发 `scroll`，
 *   Android 只发 `resize`，只监听一个会出现「某一半设备不跟随」；
 * - 用 rAF 合并，避免一帧内多次写入引发排版抖动。
 */

import { onBeforeUnmount, onMounted } from 'vue'

/** 写入 CSS 变量的属性名。改这里要同步改 `styles/tokens.css`。 */
const PROPERTY = '--vv-gap'

/**
 * 计算底边差值（px，≥0 时才有意义）。
 *
 * `offsetTop + height` 是 visual viewport 的底边在 layout 坐标里的位置；
 * 用 `innerHeight`（layout viewport 高度）减去它，就是被浏览器 UI 占掉的高度。
 *
 * 键盘弹出时这个值会变得很大（半个屏幕），此时**不应该**把底栏推到键盘上方
 * —— 那是搜索框自己的事（`SearchPanel` 用 `interactive-widget` 处理）。
 * 所以超过屏幕 40% 的值一律视为「键盘弹起」，钳到安全值，避免底栏飞到半空。
 */
function measure(): number {
  const viewport = window.visualViewport
  if (!viewport) return 0

  const gap = window.innerHeight - (viewport.offsetTop + viewport.height)
  if (!Number.isFinite(gap) || gap <= 0) return 0

  // 键盘弹起：保留一点点抬升（避免底栏与键盘边缘重叠），但不要跟着飞上去
  const limit = window.innerHeight * 0.4
  return gap > limit ? Math.min(limit, 24) : gap
}

/** 把结果写进 `:root`，并在无变化时跳过（避免无意义的样式重算）。 */
function apply(): void {
  const root = document.documentElement
  const value = `${Math.round(measure())}px`
  if (root.style.getPropertyValue(PROPERTY) === value) return
  root.style.setProperty(PROPERTY, value)
}

/**
 * 启动视口补偿。
 *
 * 只在客户端执行（SSR 期间没有 `window`）。
 * 整个应用只需要挂一次，由 `PageShell` 负责。
 */
export function useViewportInset(): void {
  if (typeof window === 'undefined') return

  let frame = 0

  const schedule = (): void => {
    if (frame) return
    frame = window.requestAnimationFrame(() => {
      frame = 0
      apply()
    })
  }

  const viewport = window.visualViewport

  onMounted(() => {
    // 先算一次：从上一页跳过来时可能已经处于「工具栏收起」状态
    apply()
    viewport?.addEventListener('resize', schedule)
    viewport?.addEventListener('scroll', schedule)
    window.addEventListener('orientationchange', schedule)
  })

  onBeforeUnmount(() => {
    if (frame) window.cancelAnimationFrame(frame)
    viewport?.removeEventListener('resize', schedule)
    viewport?.removeEventListener('scroll', schedule)
    window.removeEventListener('orientationchange', schedule)
  })
}
