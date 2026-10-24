/**
 * 主题切换过渡。
 *
 * =========================================================
 * 问题：切主题只有画布在变色
 * =========================================================
 *
 * `base.css` 给 `body` 挂了
 * `transition: background-color 200ms, color 200ms`。于是切换主题时：
 *
 * | 元素             | 有没有过渡 | 观感           |
 * |------------------|------------|----------------|
 * | 画布（body 底色）| 有，200ms  | 慢慢变         |
 * | 正文文字         | 有（继承自 body 的 color）| 慢慢变 |
 * | 页头 / 卡片 / 侧栏 / 代码块 / 边框 | **没有** | 瞬间跳 |
 *
 * 结果是"画布渐变、其它同时啪地换掉"——最刺的是**页头**：
 * 它是一块和画布不同色的粘性条，瞬间换色会在页面顶部闪一条。
 *
 * =========================================================
 * 为什么不用"给所有组件加 transition"
 * =========================================================
 *
 * 那是常见做法，但在这个站上有两个具体代价：
 *
 * 1. **常驻代价**：`transition` 是常驻的 —— 一旦挂上，
 *    滚动时页头的半透明变化、悬停变色、骨架淡入…全部会走 200ms 补间。
 *    读者会明显感觉"悬停反应变慢了"。
 * 2. **改不完**：颜色来自令牌，而令牌被几十个选择器引用。
 *    要覆盖完整就得给 `*` 加过渡 —— 那会让**滚动**也参与补间
 *    （滚动条颜色、吸顶阴影），是公认的性能坑。
 *
 * 而读者其实只想让"切换的那一刻"有过渡。View Transitions 正好是
 * "仅在这一次状态变化时拍快照并交叉淡入"，**没有任何常驻代价**。
 *
 * =========================================================
 * 为什么必须同步翻转 isDark
 * =========================================================
 *
 * `document.startViewTransition(cb)` 的 cb 必须是**同步**修改 DOM 的：
 * 浏览器在 cb 返回后才拍"新"快照。若 cb 里 `await` 了什么
 * （例如等 computed 刷新），新快照可能在 DOM 还没变时就拍了 ——
 * 表现为"闪了一下但什么都没变"。
 *
 * `isDark` 是 Vue 的 ref，赋值后 DOM 是在**下一个 tick** 才 patch 的。
 * 所以这里的做法是：赋值 → `await nextTick()` → 然后才让 cb 的 promise resolve。
 * 即把"等 Vue 渲染"放在 cb **内部**，而不是让 cb 提前返回。
 *
 * =========================================================
 * 边界
 * =========================================================
 *
 * - 减少动效：完全不启动过渡，直接同步切换（不做任何动画）；
 * - 不支持 View Transitions：同上，功能不受影响；
 * - 已有过渡在跑（连点）：Browser 会抛 `InvalidStateError`，
 *   这里 catch 后降级为直接切换 —— 不能因为动画失败就不换主题。
 */

import { nextTick } from 'vue'

/**
 * 主题交叉淡入时长。
 *
 * ⚠️ 与 `route-transition.css` 里 `vt-theme-old/new` 的 220ms **必须一致**。
 * 这里不用它控制动画（动画由 CSS 执行），只用来兜底一个上限：
 * 万一 `transition.finished` 因为浏览器 bug 永不 resolve，
 * 不至于让 `html.theme-flipping` 类永久留在 `<html>` 上。
 */
const THEME_FLIP_MS = 220

function supportsViewTransition(): boolean {
  return typeof document !== 'undefined' && typeof document.startViewTransition === 'function'
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * 在一次交叉淡入里执行主题切换。
 *
 * @param flip 同步修改主题的函数（通常是 `isDark.value = next`）。
 *
 * 返回 promise 供测试等待；调用方不需要 await（失败也不影响功能）。
 */
export async function startThemeTransition(flip: () => void): Promise<void> {
  if (typeof document === 'undefined') {
    flip()
    return
  }

  if (!supportsViewTransition() || prefersReducedMotion()) {
    flip()
    return
  }

  /*
   * 临时关掉 body 那条 200ms 颜色过渡。
   *
   * 不停掉它的话：交叉淡入的 220ms 里，body 还在自己补间颜色 ——
   * 两个动画叠加会让画布在淡入结束后**再变一次**，看起来像闪了两下。
   * View Transitions 已经把"变化过程"接管了，常驻过渡必须让位。
   */
  const previousTransition = document.body.style.transition
  document.body.style.transition = 'none'
  let applied = false

  /*
   * 给 `<html>` 打一个标记类，让 CSS 能区分"主题切换"与"页面切换"。
   *
   * 两者共用同一组 `::view-transition-*` 伪元素（都作用在 `root` 上），
   * 若写成同一个选择器，后定义的那套永远胜出 —— 于是页面切换会莫名
   * 用上主题的时长。用类名把两套动画分开（见 route-transition.css）。
   *
   * 必须在 `startViewTransition()` **之前**加上：伪元素的样式在过渡
   * 启动时解析，之后再改类名不会影响已经在跑的那次。
   */
  const root = document.documentElement
  root.classList.add('theme-flipping')

  try {
    const transition = document.startViewTransition(async () => {
      flip()
      applied = true
      // 等 Vue 把 class 打到 <html> 上（VitePress 用 .dark 切换主题）
      await nextTick()
    })

    /*
     * 等过渡结束，但**加一个上限**。
     *
     * `transition.finished` 在正常情况下会 resolve；但它也可能永不 resolve
     * （标签页在过渡中被隐藏、浏览器 bug）。若一直 await 下去，
     * `finally` 就永远不执行 —— 后果是 `html.theme-flipping` 永久留在
     * `<html>` 上，之后每次页面切换都会误用主题那套 220ms 动画，
     * 而且 `body` 的 transition 被永久置为 `none`（全站失去颜色过渡）。
     *
     * 这是"动画挂了不能拖累功能"的典型场景：宁可提前收尾，也不能卡住。
     */
    await Promise.race([
      transition.finished,
      new Promise<void>((resolve) => setTimeout(resolve, THEME_FLIP_MS + 200)),
    ])
  } catch {
    /*
     * 连点、或已有过渡在跑时，浏览器会拒绝新的过渡（`InvalidStateError`）。
     *
     * 此时 `flip()` 可能压根没被执行（抛错发生在调用 cb 之前），
     * 所以补一次。**补一次是安全的**：`flip` 是"赋一个绝对的新值"
     * 而不是"取反"，重复调用只是把同一个值再写一遍（Vue 会跳过无变化的赋值）。
     */
    if (!applied) flip()
  } finally {
    root.classList.remove('theme-flipping')
    document.body.style.transition = previousTransition
  }
}
