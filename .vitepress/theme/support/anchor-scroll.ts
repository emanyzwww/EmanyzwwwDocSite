/**
 * 目录 / 锚点跳转的平滑滚动。
 *
 * =========================================================
 * 架构：本文件是锚点滚动的**唯一**执行者
 * =========================================================
 *
 * `base.css` 里有 `html { scroll-behavior: smooth }`，但 VitePress 的路由
 * 在 `scrollTo()` 里对超过一屏的距离显式写 `window.scrollTo(0, targetTop)`
 * （硬跳），`scroll-behavior` 管不到它。而目录的作用恰恰是跨章节跳转。
 *
 * 更根本的问题是**执行者冲突**：VitePress 在 `createRouter()` 里注册了
 * `window` 捕获阶段的点击委托，会 `preventDefault()` 并把滚动排在
 * `requestAnimationFrame` 里 —— 那次滚动**没有任何办法取消**。
 * 移动端目录是浮层，点击时还持着滚动锁（iOS 上 body 被 fixed）：
 *
 * - Android：`html { overflow: hidden }` 只禁用户滚动、不禁脚本滚动，
 *   那个幻影 rAF 真的会把页面先跳走；约 160ms 后浮层退出动画播完、
 *   锁释放，`releaseScrollLock()` 又把页面**还原回点击前的位置**；
 * - 最后排队的平滑滚动才真正执行。
 *
 * 三段连起来就是「先抽搐一下，然后再平滑跳过去」。
 *
 * 解法不是给下游打补丁（排队 / 冷却 / 还原时序都试过，治标），而是
 * **让 VitePress 根本不接手**：它的委托对 `closest('.vp-raw')` 的链接
 * 直接放行（router.js 的 `link.closest('.vp-raw')` 分支），而 `.vp-raw`
 * 在 VitePress 里没有任何 CSS 语义，是干净的豁免通道。
 *
 * 于是分工变成一条线，不再赌时序：
 *
 * | 目标                       | 谁渲染        | 谁接管滚动           |
 * |----------------------------|---------------|----------------------|
 * | 桌面目录 `.toc__list`      | OutlineCard   | 本文件（vp-raw 放行）|
 * | 移动目录 `.m-toc__list`    | MobileDock    | 本文件（vp-raw 放行）|
 * | 正文标题 `header-anchor`   | VitePress 构建| 本文件（构建期打标） |
 * | 其它页内锚点（脚注等）      | 作者手写      | 浏览器默认           |
 *
 * `header-anchor` 由 VitePress 生成，组件层摸不到，所以在
 * `theme/index.ts` 的 `onContentUpdated` 里统一补打 `vp-raw`。
 *
 * 三个必须保留的语义：
 * 1. 更新 `location.hash` —— 否则浏览器前进/后退、以及分享链接都坏了；
 * 2. 给粘性页头留空隙（读 `scroll-padding-top`，与浏览器原生锚点定位同源）；
 * 3. `prefers-reduced-motion` 下**立刻**跳，不做动画。
 * 4. **滚动锁未释放时排队** —— 手机上目录在浮层里，那时 body 被固定在
 *    iOS 上，直接滚会静默失败（详见 `requestAnchorScroll`）。
 */

import { isScrollLocked, onScrollLockRelease } from './overlay'

/**
 * 顶部留白（px）：直接读 `scroll-padding-top` 的**解析值**。
 *
 * ---------- 为什么不再读 `--anchor-offset` ----------
 *
 * `--anchor-offset` 声明为 `calc(var(--header-height) + var(--space-4))`，
 * 而 `getComputedStyle` 对自定义属性返回的是**声明时的原文**（未解析的
 * calc 文本），必须自己猜单位、自己回退 —— 旧实现为此写了三重回退，
 * 且移动端（header 3.5rem）与桌面（4rem）算出的值不同，
 * 与 VitePress `scrollOffset: 80` 组成了两套不一致的偏移来源。
 *
 * `scroll-padding-top` 是标准属性，浏览器已经把 calc 解析成 px，
 * 读到的就是最终生效值 —— 与原生锚点定位、目录高亮（useActiveAnchor）
 * 永远同源，谁也不用再对齐谁。
 */
const FALLBACK_ANCHOR_OFFSET = 80

function anchorOffset(): number {
  if (typeof window === 'undefined') return FALLBACK_ANCHOR_OFFSET
  const raw = getComputedStyle(document.documentElement).scrollPaddingTop
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) ? value : FALLBACK_ANCHOR_OFFSET
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
 * 点击监听在**捕获阶段**运行，此时浮层组件的 `@click` 还没跑，
 * 我们没法（也不该）替它去改浮层状态。而且即使能关，`usePresence`
 * 还要留 160ms 播退出动画 —— 锁要等动画结束才释放。
 * 所以只能"登记意图，等锁释放后执行"。
 *
 * 排队带来的额外好处：滚动不会在遮罩还在淡出时从底下窜上去，
 * 观感是「浮层收起 → 然后跳到目标」，更符合因果。
 *
 * （在 vp-raw 接管之前，本文件挂在 document 捕获、晚于 VitePress 的
 * window 捕获，只能"后发制人"再滚一次去覆盖 VitePress 那次 ——
 * 正是那次覆盖与 `releaseScrollLock()` 的还原组成了抽搐。现在
 * VitePress 已被 vp-raw 挡在门外，排队的就是唯一的一次滚动。）
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
  // 尊重更早的处理者（vp-raw 接管后 VitePress 已放行，这条只是防御）
  if (event.defaultPrevented) return

  const target = event.target as Element | null
  const anchor = target?.closest?.('a')
  if (!(anchor instanceof HTMLAnchorElement)) return

  const href = anchor.getAttribute('href')
  if (!href || !href.startsWith('#') || href === '#') return

  const isToc = anchor.closest('.toc__list, .m-toc__list')
  const isHeadingAnchor = anchor.classList.contains('header-anchor')
  if (!isToc && !isHeadingAnchor) return

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
 * ---------- 时序：vp-raw 之内的链接只此一家 ----------
 *
 * ```
 * VitePress  → window 上的捕获监听（createRouter 里注册）
 * 本文件     → document 上的捕获监听
 *
 * 传播顺序：window(捕获) → document(捕获) → 目标 → document(冒泡) → window(冒泡)
 *                              ↑ 我们在这
 * ```
 *
 * 本来 VitePress 永远先跑、且它的滚动无法取消 —— 所以目录链接一律
 * 打上 `vp-raw`（VitePress 委托对它直接 return，见文件顶注），
 * 它们只到达本文件，成为唯一的一次滚动。不存在"抢跑"，无需解释竞态。
 *
 * 为什么挂在 `document` 而不是 `window`：`document` 是页面内容边界，
 * 将来若嵌入别的东西，我们只管自己的文档。
 *
 * 只接管两类目标：
 * - `.toc__list` / `.m-toc__list` 里的目录链接（渲染层已带 vp-raw）；
 * - 正文标题旁的 `header-anchor`（onContentUpdated 时补打 vp-raw）。
 *
 * 其余锚点（脚注、页内自定义链接）保持浏览器默认行为 ——
 * 它们的距离通常很短，原生行为已经够好，接管反而不一致。
 */
export function installAnchorScroll(): () => void {
  if (typeof document === 'undefined') return () => {}

  document.addEventListener('click', onAnchorClick, true)
  return () => document.removeEventListener('click', onAnchorClick, true)
}

/**
 * 给正文里的 `header-anchor` 补打 `vp-raw`。
 *
 * 这些 `<a>` 由 VitePress 的 markdown 渲染器生成，组件层无法加类，
 * 只能在内容更新后统一补。由 `theme/index.ts` 在 `onContentUpdated`
 * 与首帧各调一次。
 *
 * 打标之前若读者点了标题锚（理论上只有首帧前这一瞬），会退回
 * VitePress 的默认滚动 —— 功能正确，只是不保证平滑，可接受。
 */
export function markHeaderAnchorsRaw(): void {
  if (typeof document === 'undefined') return
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>('.header-anchor')) {
    anchor.classList.add('vp-raw')
  }
}
