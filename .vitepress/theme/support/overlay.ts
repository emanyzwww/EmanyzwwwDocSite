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

/* ------------------------------------------------------------------ *
 * 浮层强制关闭登记表
 * ------------------------------------------------------------------ */

/**
 * 所有「模态浮层」的强制关闭函数。
 *
 * ---------- 为什么需要它 ----------
 *
 * 这是搜索面板一个**真实的 bug**（headless Chrome 实测）：
 *
 * 面板里的搜索结果是普通 `<a href>`。VitePress 在 `createRouter()` 里注册了
 * `window` 上**捕获阶段**的点击委托，会 `preventDefault()` 并改成客户端路由。
 * 结果就是：页面确实换了，但面板没关、滚动锁也没释放 ——
 *
 * ```
 * panelPresent: true
 * scrollLocked: true      （html.style.overflow === 'hidden'）
 * canScroll:    false
 * ```
 *
 * 读者从搜索结果点进文章，看到的是**一个被半透明遮罩盖住、滚不动的新页面**，
 * 只能按 Esc 才能脱身。原来的实现依赖「点击后整页跳转」来顺带销毁面板，
 * 而捕获阶段的委托让整页跳转根本没发生。
 *
 * 修法不能靠在 `SearchPanel` 里加 `watch(route.path)` 一条路：
 * 抽屉、目录 sheet、图片查看器有同样的问题（读者在抽屉里点导航项、
 * 在查看器里点"打开原图"再回来），逐个补 watch 会漏。
 * 所以统一登记，在**导航前**一次性关干净 —— 这也是 `route-transition.ts`
 * 里 `onBeforeRouteChange` 要调它的原因。
 */
const overlayClosers = new Set<() => void>()

/**
 * 登记一个浮层的强制关闭函数。
 *
 * @returns 注销函数（组件卸载时调用）。
 *
 * 登记的应该是「把开关置为 false」的动作，而不是「立刻销毁 DOM」——
 * 销毁交给 `usePresence` 决定，这样强制关闭时**仍然有退出动画**。
 */
export function registerOverlayCloser(closer: () => void): () => void {
  overlayClosers.add(closer)
  return () => overlayClosers.delete(closer)
}

/**
 * 关闭所有已登记的浮层。由路由切换前调用。
 *
 * 幂等且安全：没有浮层时是空操作；已经关掉的浮层再关一次只是把
 * 同一个 ref 又设一遍 false（Vue 会跳过无变化的赋值）。
 */
export function closeAllOverlays(): void {
  for (const closer of overlayClosers) closer()
}

let lockCount = 0
/** 锁定时保存的原滚动位置。 */
let savedScrollY = 0
let savedStyle: {
  htmlOverflow: string
  bodyPosition: string
  bodyTop: string
  bodyWidth: string
  bodyOverflow: string
} | null = null

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
 *
 * ---------- 为什么锁的是 `<html>` 而不是 `<body>` ----------
 *
 * 这是本文件最容易被写错的一处。`base.css` 给 `html` 和 `body` 都设了
 * `overflow-x: clip`（那是为了不破坏 sticky），效果是：
 * **`body` 的 `overflow-y` 不再传播到视口**。
 *
 * CSS 规范里「body 的 overflow 传给视口」只在 html 的 overflow 为
 * `visible` 时成立。一旦 html 有了非 visible 的值，body 就不是视口代表，
 * 给它设 `overflow: hidden` 只会裁掉 body 自己的内容，**页面照样能滚**。
 *
 * 所以非 iOS 路径锁的是 `documentElement`。iOS 路径另外还要把 body
 * 固定住，因为老版本 Safari 即使 html 设了 hidden 也能滚。
 */
export function acquireScrollLock(): void {
  if (typeof document === 'undefined') return

  lockCount += 1
  if (lockCount > 1) return

  savedScrollY = window.scrollY
  const html = document.documentElement
  const body = document.body
  savedStyle = {
    htmlOverflow: html.style.overflow,
    bodyPosition: body.style.position,
    bodyTop: body.style.top,
    bodyWidth: body.style.width,
    bodyOverflow: body.style.overflow,
  }

  // 统一先锁 html：这是唯一真正能阻止页面滚动的元素
  html.style.overflow = 'hidden'

  if (isIOS()) {
    // iOS 兜底：html 锁不住时把 body 固定住，并记住位置
    body.style.position = 'fixed'
    body.style.top = `-${savedScrollY}px`
    body.style.width = '100%'
    body.style.overflow = 'hidden'
  }
}

/** 释放一次锁；计数归零时真正解锁。 */
export function releaseScrollLock(): void {
  if (typeof document === 'undefined') return

  // 防止「释放次数多于获取次数」把计数打成负数
  if (lockCount === 0) return

  lockCount -= 1
  if (lockCount > 0) return

  if (!savedStyle) return

  const html = document.documentElement
  const body = document.body

  html.style.overflow = savedStyle.htmlOverflow
  body.style.position = savedStyle.bodyPosition
  body.style.top = savedStyle.bodyTop
  body.style.width = savedStyle.bodyWidth
  body.style.overflow = savedStyle.bodyOverflow

  const restorePosition = body.style.position === '' ? savedScrollY : 0
  savedStyle = null

  // 固定 body 时页面视觉上回顶了，这里滚回原位
  if (restorePosition) window.scrollTo(0, restorePosition)
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
