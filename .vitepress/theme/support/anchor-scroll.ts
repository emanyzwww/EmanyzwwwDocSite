/**
 * 目录 / 锚点跳转的平滑滚动。
 *
 * =========================================================
 * 为什么需要这个（VitePress 自带的行为不够）
 * =========================================================
 *
 * `base.css` 里已经有 `html { scroll-behavior: smooth }`，但**它管不到
 * 锚点点击**：VitePress 的 router 在 `scrollTo()` 里显式写了
 *
 * ```js
 * if (!smooth || Math.abs(targetTop - window.scrollY) > window.innerHeight)
 *   window.scrollTo(0, targetTop)          // ← 硬跳
 * else
 *   window.scrollTo({ top, behavior: 'smooth' })
 * ```
 *
 * 也就是说：**只有当目标距当前位置不到一屏时才会平滑滚动**。
 * 而目录的作用恰恰是跨章节跳转 —— 几乎总比一屏远，所以实测下来
 * 点目录永远是硬跳，`scroll-behavior: smooth` 那行等于没生效。
 *
 * （它那个 `innerHeight` 判断的本意是"别让读者等太久"，
 * 但对本站这种长文 + 固定侧栏目录的结构，硬跳的失位感比等待更难接受：
 * 视线要从右栏"啪"地跳到正文中段，完全丢失了"我跳到哪了"的过渡。）
 *
 * =========================================================
 * 做法：只接管锚点点击，不碰页面切换
 * =========================================================
 *
 * 不用覆写 `window.scrollTo`（那会影响所有调用方，包括进度条、
 * 滚动恢复、以及 `useDockState` 的"回到顶部"）。
 * 只在**点击目录/标题锚点**时自己滚，并 `preventDefault()` 让 VitePress
 * 的 router 不再接管。
 *
 * 三个必须保留的语义：
 * 1. 更新 `location.hash` —— 否则浏览器前进/后退、以及分享链接都坏了；
 * 2. 给粘性页头留空隙（读 `--anchor-offset`，与 `scroll-padding-top` 同源）；
 * 3. `prefers-reduced-motion` 下**立刻**跳，不做动画。
 */

/** 屏幕顶部该留出的空隙（px）。与 `--anchor-offset` 保持一致。 */
function anchorOffset(): number {
  if (typeof window === 'undefined') return 80
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--anchor-offset')
  return parseAnchorOffset(raw)
}

/**
 * 把 `--anchor-offset` 的原始字符串解析成 px。
 *
 * 抽成纯函数是为了能单测 —— 它有两个容易错的地方：
 *
 * 1. `--anchor-offset` 的值是 `calc(var(--header-height) + var(--space-4))`，
 *    **不是**一个带单位的数字。`getComputedStyle` 对自定义属性返回的是
 *    **声明时的原样文本**（未解析 calc），所以这里拿到的常常是空串，
 *    于是只能回退；
 * 2. 即便拿到了 `4.5rem` 这种值，也要换算成 px —— 直接 `parseFloat`
 *    会把 rem 当 px 用，锚点会偏掉半个屏幕。
 *
 * @param raw 自定义属性原文（可能带 `rem` / `px` 后缀，也可能是空串）
 * @param rootFontSize 根字号，默认 16px（测试可传固定值）
 */
export function parseAnchorOffset(raw: string, rootFontSize = 16): number {
  const trimmed = raw.trim()
  if (!trimmed || trimmed.startsWith('calc')) return 80

  const value = Number.parseFloat(trimmed)
  if (!Number.isFinite(value)) return 80

  if (trimmed.endsWith('rem')) return value * rootFontSize
  if (trimmed.endsWith('px')) return value
  // 无单位：按 px 处理（`getPropertyValue` 在部分浏览器会去掉单位）
  return value
}

/** 系统是否要求减少动效。 */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * 滚动到某个锚点。
 *
 * @returns 是否成功找到目标（找不到时返回 false，交给浏览器默认行为）。
 */
export function scrollToAnchor(hash: string): boolean {
  if (typeof document === 'undefined') return false

  const id = decodeURIComponent(hash.replace(/^#/, ''))
  const target = document.getElementById(id)
  if (!target) return false

  const top = window.scrollY + target.getBoundingClientRect().top - anchorOffset()
  window.scrollTo({
    top: Math.max(0, top),
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
  })
  return true
}

/**
 * 点击处理体。
 *
 * 抽到模块作用域而不是写成 `installAnchorScroll` 内的闭包：
 * 它不捕获任何安装期变量（全靠 `event`），每次安装重建一份是浪费。
 */
function onAnchorClick(event: MouseEvent): void {
  // 修饰键 / 非左键：让浏览器开新标签页，不要接管
  if (event.defaultPrevented) return
  if (event.button !== 0) return
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

  const target = event.target as Element | null
  const anchor = target?.closest?.('a')
  if (!(anchor instanceof HTMLAnchorElement)) return

  const href = anchor.getAttribute('href')
  if (!href || !href.startsWith('#') || href === '#') return

  const isToc = anchor.closest('.toc__list, .m-toc__list')
  const isHeadingAnchor = anchor.classList.contains('header-anchor')
  if (!isToc && !isHeadingAnchor) return

  // 找不到目标（锚点失效）就放行，交给浏览器的"跳不过去"默认行为
  if (!scrollToAnchor(href)) return

  event.preventDefault()
  // 更新地址栏但不触发滚动：`history.pushState` 不会像赋 hash 那样跳
  history.pushState({ scrollPosition: window.scrollY }, '', href)
  /*
   * 同步派发 `hashchange`：VitePress 的 router 监听它并 `preventDefault()`
   * （它只是用它拦截浏览器默认滚动）。我们自己滚完了，派发一次让
   * 其它监听者（例如将来的分析/高亮逻辑）能收到同一次语义事件。
   */
  window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL: location.href }))
}

/**
 * 装一个全局的锚点点击接管。
 *
 * 用**捕获阶段**：VitePress 的 router 也是在 `window` 上以捕获阶段注册的，
 * 且它在 `enhanceApp` 之后才装（主题先装，router 在 `createApp` 里先建，
 * 但监听器在 `createRouter` 内注册 —— 早于我们的 `enhanceApp`）。
 * 因此在**冒泡阶段**处理并 `preventDefault()` 已经太晚：router 早就
 * `preventDefault()` 并自己滚过了。
 *
 * 所以必须抢在它前面 —— 用捕获阶段 + 自己 `preventDefault()`，
 * 这样 router 的 `if (e.defaultPrevented) return` 会放行，
 * 它就完全不会介入（见 vitepress/dist/client/app/router.js 第一行判断）。
 *
 * 只接管两类目标：
 * - `.toc__list` / `.m-toc__list` 里的目录链接；
 * - 正文标题旁的 `header-anchor`。
 *
 * 其余锚点（脚注、页内自定义链接）保持浏览器默认行为 ——
 * 它们的距离通常很短，原生行为已经够好，接管反而不一致。
 */
export function installAnchorScroll(): () => void {
  if (typeof document === 'undefined') return () => {}

  // 捕获阶段：必须早于 VitePress 的委托（理由见函数注释）
  document.addEventListener('click', onAnchorClick, true)
  return () => document.removeEventListener('click', onAnchorClick, true)
}
