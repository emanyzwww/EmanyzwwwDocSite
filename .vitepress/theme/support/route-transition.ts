/**
 * 页面切换过渡（View Transitions API）。
 *
 * =========================================================
 * 为什么用 View Transitions，而不是给 <Content> 套 <Transition>
 * =========================================================
 *
 * Vue 的 `<Transition>` 要求树里有一个**稳定的 key** 才能做进出对比。
 * 但 VitePress 的页面渲染是 `<component :is="route.component" />`，
 * 组件类型每页都不同 —— 理论上能套，实际上有三个坑：
 *
 * 1. `<Content />` 是异步组件，`<Transition>` 会拿到未 resolve 的占位，
 *    过渡的往往是"骨架淡出 → 骨架淡入"，不是最终内容；
 * 2. `<Transition>` 会**延迟真实 DOM 的挂载/卸载**，而 VitePress 依赖
 *    `onContentUpdated` 在内容更新后重新标记代码块复制按钮、
 *    重新算目录高亮 —— 生命周期被拖后会漏掉这一轮；
 * 3. 必须在路由切换前就决定"旧内容是哪个组件"，那需要自己缓存 vnode。
 *
 * View Transitions 完全绕开这些：浏览器在**合成层**对当前像素拍快照，
 * 然后等 DOM 换完再拍一张，两张交叉淡入。**Vue 的渲染时序一点没动**，
 * 出问题也只是"没有过渡"，不会影响功能。
 *
 * =========================================================
 * 接线方式（为什么不是自己拦点击）
 * =========================================================
 *
 * 最直觉的做法是截获 `<a>` 点击、自己调 `router.go()`。做不到：
 * VitePress 在 `createRouter()` 里就注册了 `window` 上的
 * **捕获阶段**委托，而我们主题的 `enhanceApp` 在它之后才执行。
 * 同一目标、同为捕获阶段时按注册顺序触发 —— 轮不到我们。
 *
 * 所以改用 VitePress 自己的路由钩子。时机正好：
 *
 * ```
 * go(href)
 *   → onBeforeRouteChange   ← 此刻 DOM 还是旧页面：拍「旧」快照
 *   → history.pushState
 *   → loadPage()            ← 异步 import 新页面
 *   → route.component 更新   ← Vue 在这之后的下一个 tick 才真正 patch DOM
 *   → onAfterRouteChange    ← await nextTick() 后 DOM 已是新页面：结束「更新」
 * ```
 *
 * `startViewTransition(cb)` 的语义是「先拍旧快照 → 调 cd → 等 cb 返回的
 * promise resolve → 拍新快照 → 播放交叉淡入」。我们让 cb 返回一个
 * **由 `onAfterRouteChange` 手动 resolve 的 promise**，就把两段时间精确
 * 对齐了，中间不需要任何 sleep/猜测。
 *
 * =========================================================
 * 三个必须处理的边界
 * =========================================================
 *
 * 1. **预览式回退**：`onBeforeRouteChange` 可以返回 false 取消导航。
 *    若被取消而我们已 promise 悬空，动画会永远停在"旧快照"上 ——
 *    表现为整个页面被一张静止截图盖住，页面看起来死了。所以有硬超时。
 * 2. **浏览器前进/后退（popstate）**：VitePress 的 popstate 处理**不走**
 *    `go()`，因此不会触发 `onBeforeRouteChange` —— 我们拿不到旧快照。
 *    这时不能启动过渡（`releaseUpdate` 为 null 就直接返回），
 *    退化成硬切，与改造前一致。
 * 3. **`prefers-reduced-motion`**：整页交叉淡入是最大面积的运动，
 *    必须在 reduce 下**完全不启动**（不是把时长压到 0）。
 *
 * 还有一个顺手修掉的 bug（见 `closeAllOverlays`）：跳转前先关掉所有浮层。
 * 搜索面板原先在点击结果后既不关闭、也不释放滚动锁。
 */

import { nextTick } from 'vue'

import { closeAllOverlays } from './overlay'

/** VitePress `Router` 的最小结构（避免直接依赖其类型声明）。 */
interface RouterLike {
  onBeforeRouteChange?: (to: string) => unknown
  onAfterRouteChange?: (to: string) => unknown
}

/**
 * 结束「更新阶段」的保险时限（毫秒）。
 *
 * 取值远大于一次正常导航（实测站内跳转 40–120ms，最慢的首页冷加载 ~400ms），
 * 但也不能太大 —— 它是"页面被静止快照盖住"的持续时间上限。
 */
const SETTLE_TIMEOUT_MS = 900

/** 是否支持 View Transitions（Safari 18+ / Chrome 111+ / Firefox 尚未）。 */
function supportsViewTransition(): boolean {
  return typeof document !== 'undefined' && typeof document.startViewTransition === 'function'
}

/** 是否要求减少动效。每次调用都重新读，因为系统设置可能中途改变。 */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * 安装路由过渡。
 *
 * 由 `theme/index.ts` 的 `enhanceApp` 调用一次（只有客户端）。
 * 返回卸载函数（目前没有调用点，但保留以便将来 HMR 或测试使用）。
 */
export function installRouteTransition(router: RouterLike): () => void {
  if (typeof document === 'undefined') return () => {}

  /** 待 resolve 的「更新完成」钩子；非 null 表示过渡正在进行。 */
  let releaseUpdate: (() => void) | null = null
  /** 保险超时的定时器 id（0 表示没有）。 */
  let settleTimer = 0

  /** 立即结束当前过渡并清理定时器。 */
  function settle(): void {
    if (settleTimer) {
      clearTimeout(settleTimer)
      settleTimer = 0
    }
    const release = releaseUpdate
    releaseUpdate = null
    release?.()
  }

  router.onBeforeRouteChange = (): void => {
    /*
     * 顺序很重要：先关浮层，再起过渡。
     *
     * 如果反过来，拍「旧」快照时搜索面板还盖在屏幕上 —— 于是过渡的
     * 第一帧是"带着遮罩的旧页"，第二帧是"干净的新页"，
     * 读起来像面板又闪了一下。先关掉，快照里就是读者期待看到的页面。
     */
    closeAllOverlays()

    if (!supportsViewTransition() || prefersReducedMotion()) return

    // 上一次尚未结束（极快的连续导航）：强制结算，避免两个过渡叠在一起
    if (releaseUpdate) settle()

    let release!: () => void
    const update = new Promise<void>((resolve) => {
      release = resolve
    })
    releaseUpdate = release

    try {
      document.startViewTransition(() => update)
    } catch {
      // 已经在一次过渡中（浏览器会抛错）：放弃本次过渡，别影响导航
      settle()
      return
    }

    settleTimer = window.setTimeout(settle, SETTLE_TIMEOUT_MS)
  }

  router.onAfterRouteChange = async (): Promise<void> => {
    if (!releaseUpdate) return

    /*
     * `nextTick` 等 Vue 把 `route.component` 的替换真正 patch 到 DOM。
     *
     * 只等 nextTick 不够：新页面的样式（尤其是代码块高亮后的行高、
     * 图片占位）会在下一帧才稳定，早一帧拍到的快照会是"半截布局"。
     * 再等一个 rAF 让浏览器完成一次布局，快照才是最终形态。
     */
    await nextTick()
    await new Promise<void>((resolve) => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve())
      else setTimeout(resolve, 16)
    })

    settle()
  }

  return () => {
    settle()
    router.onBeforeRouteChange = undefined
    router.onAfterRouteChange = undefined
  }
}
