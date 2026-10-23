/**
 * 全站滚动锁（引用计数）。
 *
 * ---------- 为什么需要「计数」 ----------
 *
 * 抽屉与搜索面板**都能**在页面上打开，而且打开顺序任意：
 * 先开抽屉 → 再开搜索 → 关搜索 → 关抽屉。
 *
 * 如果两处各自直接写 `document.body.style.overflow`：
 *
 * | 步骤        | 抽屉写的值 | 搜索写的值 | 实际生效 |
 * |-------------|------------|------------|----------|
 * | 开抽屉      | hidden     | —          | hidden   |
 * | 开搜索      | hidden     | hidden     | hidden   |
 * | 关搜索      | hidden     | **''**     | **''** ← 抽屉还开着，但背景已能滚 |
 * | 关抽屉      | …          | …          | ''       |
 *
 * 反过来（先搜索后抽屉）则会**锁死**：两个浮层都关了，`overflow` 还是
 * `hidden`，页面再也滚不动。这是旧实现里两个组件共享同一属性却没有
 * 协调机制导致的真实 bug。
 *
 * 用引用计数后，只有计数归零才真正恢复。调用方只关心自己「持有」还是
 * 「释放」，不需要知道别人。
 *
 * ---------- 为什么还要 `position: fixed` 兜底 ----------
 *
 * iOS Safari（尤其是 15 之前的版本）**不认** `body { overflow: hidden }`：
 * 页面照样能滚。常规做法是同时记录滚动位置并把 body 固定住。
 * 这里只在需要时启用（`iOS` 判定 + 确实有浮层打开），
 * 桌面不受任何影响。
 */

let lockCount = 0
/** iOS 兜底模式下保存的原滚动位置。 */
let savedScrollY = 0
let savedStyle: { position: string; top: string; width: string; overflow: string } | null = null

/** 是否是 iOS（含 iPadOS，它的 UA 伪装成 Mac，用触点数区分）。 */
function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  if (/iPad|iPhone|iPod/.test(ua)) return true
  // iPadOS 13+ 的 UA 与桌面 Safari 相同，靠「Mac + 多点触控」识别
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1
}

/**
 * 获取一次锁。
 *
 * 必须在 `releaseScrollLock()` 配对调用（组件卸载时也要调，
 * 否则浮层因路由切换被销毁时锁会永久残留）。
 */
export function acquireScrollLock(): void {
  if (typeof document === 'undefined') return

  lockCount += 1
  if (lockCount > 1) return

  if (isIOS()) {
    // iOS：overflow 无效，改用「固定 body + 记住位置」
    savedScrollY = window.scrollY
    const body = document.body
    savedStyle = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    }
    body.style.position = 'fixed'
    body.style.top = `-${savedScrollY}px`
    body.style.width = '100%'
    // overflow 也写上，让不依赖 fixed 的浏览器（如 Android）行为一致
    body.style.overflow = 'hidden'
    return
  }

  document.body.style.overflow = 'hidden'
}

/** 释放一次锁；计数归零时真正解锁。 */
export function releaseScrollLock(): void {
  if (typeof document === 'undefined') return

  // 防止「释放次数多于获取次数」把计数打成负数
  if (lockCount === 0) return

  lockCount -= 1
  if (lockCount > 0) return

  if (isIOS() && savedStyle) {
    const body = document.body
    body.style.position = savedStyle.position
    body.style.top = savedStyle.top
    body.style.width = savedStyle.width
    body.style.overflow = savedStyle.overflow
    savedStyle = null
    // 固定 body 时页面回顶了，这里滚回原位
    window.scrollTo(0, savedScrollY)
    return
  }

  document.body.style.overflow = ''
}

/**
 * 焦点陷阱：把 Tab 限制在当前浮层内。
 *
 * `aria-modal="true"` 只是声明「外面是惰性的」，浏览器**不会**因此
 * 阻止 Tab 走出去。不配焦点陷阱的话，键盘用户 Tab 几次就会跑到
 * 被遮罩盖住的页面内容里，而读屏用户会读到背景内容 ——
 * 等于 `aria-modal` 只对读屏软件做了半个承诺。
 *
 * 返回清理函数，由调用方在关闭/卸载时执行。
 */
export function trapFocus(container: () => HTMLElement | null): () => void {
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return

    const root = container()
    if (!root) return

    // 只挑「真正可聚焦」的元素：排除 disabled、hidden、负 tabindex
    const focusable = Array.from(
      root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => {
      if (element.hasAttribute('hidden')) return false
      if (element.getAttribute('aria-hidden') === 'true') return false
      const style = window.getComputedStyle(element)
      return style.display !== 'none' && style.visibility !== 'hidden'
    })

    if (focusable.length === 0) return

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement

    // 焦点在容器外，或已到末尾再 Tab → 回到第一个
    if (event.shiftKey && (active === first || !root.contains(active))) {
      event.preventDefault()
      last?.focus()
      return
    }

    if (!event.shiftKey && (active === last || !root.contains(active))) {
      event.preventDefault()
      first?.focus()
    }
  }

  document.addEventListener('keydown', onKeydown)
  return () => document.removeEventListener('keydown', onKeydown)
}
