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
 * 4. **滚动锁未释放时排队** —— 手机上目录在浮层里，那时 body 被固定在
 *    iOS 上，直接滚会静默失败（详见 `requestAnchorScroll`）。
 */

import { isScrollLocked, onScrollLockRelease } from './overlay'

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
 * 请求滚动到锚点 —— **滚动锁未释放时自动排队**。
 *
 * ---------- 这个函数修的是一个真机 bug ----------
 *
 * 手机上点目录项「经常性失效」（iPhone 必现，PC 测不出）：
 *
 * 移动端目录是浮层，点目录项时浮层还开着 → 它持着滚动锁。
 * `acquireScrollLock()` 在 iOS 上会额外把 body 固定：
 *
 * ```js
 * body.style.position = 'fixed'
 * body.style.top = `-${savedScrollY}px`
 * ```
 *
 * body 一固定，`window.scrollTo()` **完全无效**，连
 * `location.hash = x` 触发的原生滚动也被吞掉。等浮层关掉、锁释放时，
 * 那次滚动请求早已作废 —— 读者的感受就是「点了没反应」。
 *
 * PC 端目录在侧栏里、不持锁，所以永远正常。这正是"PC 测不出来"的根因。
 *
 * ---------- 为什么排队而不是"先关浮层再跳" ----------
 *
 * 调用方是**捕获阶段**的点击监听，此时 Vue 的 `@click.prevent` 还没跑，
 * 我们没法（也不该）替它去改浮层状态。而且即使能关，`usePresence`
 * 还要留 160ms 播退出动画 —— 锁要等动画结束才释放。
 * 所以只能"登记意图，等锁释放后执行"。
 *
 * 排队带来的额外好处：滚动不会在遮罩还在淡出时从底下窜上去，
 * 观感是「浮层收起 → 然后跳到目标」，更符合因果。
 *
 * @returns 目标是否存在（false 时调用方应放行给浏览器默认行为）
 */
export function requestAnchorScroll(hash: string): boolean {
  if (typeof document === 'undefined') return false

  // 先确认目标存在，避免排一个注定失败的队
  const id = decodeURIComponent(hash.replace(/^#/, ''))
  if (!document.getElementById(id)) return false

  if (!isScrollLocked()) {
    scrollToAnchor(hash)
    return true
  }

  /*
   * 锁定中：等锁释放后再滚。
   *
   * `requestAnimationFrame` 不是必需的（锁释放时 DOM 已经解锁），
   * 但它能把滚动推迟到下一帧 —— 那时 `body.position` 的还原已经完成布局，
   * 量出来的 `getBoundingClientRect()` 才是正确值。
   * 少了它，iOS 上会量到 body 还固定着时的坐标。
   */
  onScrollLockRelease(() => {
    requestAnimationFrame(() => {
      scrollToAnchor(hash)
    })
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

  /*
   * ⚠️ 这里**故意不检查** `event.defaultPrevented`。
   *
   * 曾经写过 `if (event.defaultPrevented) return`（以为"别人已经处理过就放行"），
   * 结果本文件**从未执行过**：
   *
   * VitePress 在 `createRouter()` 里注册的是 **`window` 的捕获阶段**监听，
   * 而本文件挂在 **`document`** 上。DOM 事件传播顺序是
   * `window(捕获) → document(捕获) → … → document(冒泡) → window(冒泡)`，
   * 所以 **window 捕获先于 document 捕获** —— VitePress 抢在前面
   * `preventDefault()` 并自己滚了，我们随后看到 `defaultPrevented === true`
   * 就一路 return。这就是"写了半天平滑滚动、PC 上却像是它在工作"的真相：
   * 实际生效的是 VitePress 的双参数 `window.scrollTo(0, y)`，
   * 它恰好会吃 `html { scroll-behavior: smooth }`，所以 PC 看起来是对的。
   *
   * 而手机上就露馅了：那一刻滚动锁还持有（iOS 下 body 是 fixed），
   * VitePress 那次滚动被静默吞掉，于是"点目录没反应"。
   *
   * 所以这里**必须**无视 `defaultPrevented`，坚持自己滚一次。
   * 后发制人正是我们要的：等锁释放后再滚，必然覆盖掉 VitePress 失败的那次。
   */

  // 找不到目标（锚点失效）就放行，交给浏览器的"跳不过去"默认行为。
  // 锁定时这里会登记排队，等浮层关闭后再真正滚动（见 requestAnchorScroll）
  if (!requestAnchorScroll(href)) return

  event.preventDefault()
  /*
   * 更新地址栏。
   *
   * `replaceState` 而不是 `pushState`：VitePress 通常已经为同一次点击
   * push 过一条历史记录，这里再 push 会多出一条"看起来没动"的记录，
   * 表现为浏览器后退要按两次才回到上一页。
   * 只在 hash 真的变了时才写，避免无意义的替换。
   */
  if (location.hash !== href) {
    history.replaceState({ scrollPosition: window.scrollY }, '', href)
  }
}

/**
 * 装一个全局的锚点点击接管。
 *
 * ---------- 时序：我们**晚于** VitePress，这是有意的 ----------
 *
 * 一个常见的误解（本文件第一版就写错了）：挂在捕获阶段就能抢在
 * VitePress 前面。**不能**。两者在不同的节点上：
 *
 * ```
 * VitePress  → window 上的捕获监听（createRouter 里注册）
 * 本文件     → document 上的捕获监听
 *
 * 传播顺序：window(捕获) → document(捕获) → 目标 → document(冒泡) → window(冒泡)
 *                              ↑ 我们在这
 * ```
 *
 * 所以 VitePress 永远先跑。它会 `preventDefault()` 并自己调
 * `window.scrollTo(0, y)`（双参数形式，受 `scroll-behavior` 影响）。
 *
 * 既然抢不过，就不抢 —— 我们**后发制人**：无视 `defaultPrevented`，
 * 在它之后自己再滚一次（必要时排到滚动锁释放之后）。最后一次滚动生效，
 * 所以观感由我们决定。
 *
 * 为什么挂在 `document` 而不是 `window`：`document` 是页面内容边界，
 * 将来若嵌入别的东西，我们只管自己的文档。而且只要在 VitePress 之后跑
 * 就够了，没必要去争那个顺序。
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

  document.addEventListener('click', onAnchorClick, true)
  return () => document.removeEventListener('click', onAnchorClick, true)
}
