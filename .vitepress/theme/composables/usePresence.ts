/**
 * 浮层进出状态机。
 *
 * =========================================================
 * 解决什么问题
 * =========================================================
 *
 * 全站所有浮层（搜索面板、导航抽屉、目录 sheet、图片查看器、下拉菜单）
 * 原先都是 `v-if="open"`。`v-if` 的问题很具体：
 *
 * **元素在 `open` 变 false 的那一刻就被删掉了，没有任何时间可以播退出动画。**
 *
 * 于是全站呈现出同一个症状：进有动画、出是瞬断。实测（headless Chrome）
 * 关抽屉 / 关查看器都是 0ms 消失，`animationName` 根本来不及设置。
 * 这比"完全没有动画"更刺——有预期的地方落空了。
 *
 * 正确做法是把「逻辑开关」和「DOM 存在」拆成两个状态：
 *
 * | 状态      | 含义                     | 谁控制 |
 * |-----------|--------------------------|--------|
 * | `open`    | 读者认为它开着           | 业务   |
 * | `present` | DOM 是否在树上           | 本函数 |
 * | `exiting` | 是否正在播退出动画       | 本函数 |
 *
 * 关闭时 `open` 立刻变 false（业务语义正确：它已经不算"打开"了），
 * 但 `present` 再维持一个退出时长，让动画播完。
 *
 * =========================================================
 * 为什么必须有超时兜底（这是本文件最容易写错的地方）
 * =========================================================
 *
 * 直觉写法是「等 `animationend` 再移除」，但那**一定会卡死**，有四种情况：
 *
 * 1. `prefers-reduced-motion: reduce` —— 全局把 `animation-duration` 压到
 *    0.01ms，部分浏览器在这种情况下**不触发** `animationend`；
 * 2. 元素在动画期间被 `display: none`（例如祖先还在 `v-if` 里、或切到
 *    打印样式 `.lightbox { display: none }`）—— 动画被取消，不发事件；
 * 3. `animationend` **会冒泡**，子元素的动画结束事件会被父元素的监听器收到，
 *    于是提前移除 —— 表现为"退出动画只播了半帧"；
 * 4. 读者在退出动画期间又把浮层打开了（快速连点开关）——
 *    事件可能永远不来。
 *
 * 本仓库已经在图片查看器的翻页方向（`turnDirection`）上被第 1、3 条咬过一次，
 * 当时的修法是"清空 → nextTick 再设"。这里采用同样的思路，并且**以超时为准**：
 *
 * - `animationend` 只是"可以提前结束"的优化；
 * - `setTimeout(EXIT_MS + 余量)` 才是真正的保证。
 *
 * 宁可晚一帧移除，也不能把元素永久留在树上（那种 bug 表现为
 * "浮层关不掉，只能刷新页面"）。
 */

import { getCurrentScope, onScopeDispose, readonly, ref, watch, type Ref } from 'vue'

/**
 * 退出时长（毫秒）。
 *
 * ⚠️ **必须与 `tokens.css` 的 `--duration-exit` 一致。**
 * CSS 决定动画播多久，这里决定 DOM 留多久。两个值不相等时：
 * - 这里偏短 → 动画被截断（元素先没了）；
 * - 这里偏长 → 元素已经不可见却还在树上拦截点击。
 *
 * 为什么要在 TS 里重复一遍而不是读 CSS 变量：
 * `getComputedStyle` 需要元素已经挂载，而这个值在 `present` 变 true
 * **之前**就要用（决定卸载时机）。挂载前读不到，读到的也未必是当前主题下的。
 * 用一个常量 + 注释锁死一致性，比运行时读取更可靠。
 */
export const EXIT_MS = 160

/** 给 `animationend` 与真实 DOM 移除之间留的余量（一帧多一点）。 */
const EXIT_SLACK_MS = 40

export interface PresenceState {
  /** 是否应该渲染 DOM（`v-if` 用它）。 */
  present: Readonly<Ref<boolean>>
  /** 是否正在播退出动画（用来挂 `is-exiting` 类）。 */
  exiting: Readonly<Ref<boolean>>
}

/**
 * 把「逻辑开关」翻译成「DOM 是否存在 + 是否正在退出」。
 *
 * @param source 浮层的开关（通常是 `defineModel` 出来的 ref 或 `computed`）
 * @param duration 退出时长；默认 `EXIT_MS`。只有测试与特殊浮层才需要覆盖。
 *
 * @example
 * const { present, exiting } = usePresence(open)
 * // 模板里：<div v-if="present" :class="{ 'is-exiting': exiting }">
 */
export function usePresence(
  source: Readonly<Ref<boolean>> | (() => boolean),
  duration = EXIT_MS,
): PresenceState {
  const isOpen = (): boolean => (typeof source === 'function' ? source() : source.value)

  const present = ref(isOpen())
  const exiting = ref(false)

  /** 待执行的移除定时器；-1 表示没有。 */
  /**
   * 待执行的移除定时器。
   *
   * 类型用 `ReturnType<typeof setTimeout>` 而不是 `number`：
   * 浏览器返回 number，Node 返回 Timeout 对象，两个环境都要能跑
   * （本文件要能在 vitest 里被单测，见 tests/presence.test.ts）。
   */
  let timer: ReturnType<typeof setTimeout> | null = null

  function clearTimer(): void {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
  }

  /**
   * 立刻结束退出、把 DOM 摘掉。
   *
   * 供 `animationend` 调用，也供作用域销毁时清理（防定时器泄漏）。
   */
  function finish(): void {
    clearTimer()
    exiting.value = false
    present.value = false
  }

  watch(
    isOpen,
    (open) => {
      if (open) {
        // 反向：退出动画播到一半又被打开 —— 取消移除，回到稳定态
        clearTimer()
        exiting.value = false
        present.value = true
        return
      }

      // 本来就没渲染，什么都不用做（避免首次挂载时产生一次无意义的退出）
      if (!present.value) return

      exiting.value = true
      clearTimer()
      /*
       * 用全局 `setTimeout` 而不是 `window.setTimeout`：
       * SSR 与单测环境里没有 `window`，而本文件在两个环境里都会被求值
       * （`v-if` 的初值、以及组件测试）。`globalThis` 在浏览器 / Node 都有。
       */
      timer = setTimeout(finish, duration + EXIT_SLACK_MS)
    },
    { flush: 'sync' },
  )

  /*
   * 作用域销毁时清掉定时器。
   *
   * 少了这一条，路由切换把浮层组件销毁后，定时器仍会在 200ms 后
   * 触发一次 `present.value = false` —— 对已卸载的组件写 ref 虽然无害，
   * 但在 vitest 里会让"上一个用例的定时器"漏进下一个用例，
   * 表现为随机的、无法复现的失败。
   *
   * 用 `getCurrentScope()` 先判断：在组件 `setup()` 里调用时一定有作用域，
   * 但**单测里直接调用本函数时没有** —— 那时 `onScopeDispose` 会打印
   * 「no active effect scope」警告。那种情况下也确实没有作用域需要清理，
   * 跳过即可。
   */
  if (getCurrentScope()) onScopeDispose(clearTimer)

  return {
    present: readonly(present) as Readonly<Ref<boolean>>,
    exiting: readonly(exiting) as Readonly<Ref<boolean>>,
  }
}
