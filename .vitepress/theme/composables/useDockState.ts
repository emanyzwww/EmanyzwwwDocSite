/**
 * 移动端「阅读态」状态机。
 *
 * 手机会话里其实只有两种姿势，本站按它们切换整套 chrome：
 *
 * | 状态      | 页头 | 底部胶囊        | 用户在哪   |
 * |-----------|------|-----------------|------------|
 * | `rest`    | 显示 | 展开成横向胶囊  | 刚进页面 / 正在找东西 / 往上翻 |
 * | `reading` | 隐藏 | 收成右侧小圆    | 正在往下读长文 |
 *
 * 为什么「阅读态」要连页头一起隐藏：
 * 手机上垂直空间是唯一稀缺资源。页头 57px + 胶囊 52px ≈ 一屏的 1/8，
 * 长文阅读时它们只是纯装饰（用户不找导航、不看品牌），
 * 隐藏后正文有效行数明显增加。而往回滚一点就能立刻拿回来，
 * 所以这是「零代价的隐身」，不是「藏起来找不到」。
 *
 * =========================================================
 * 判定逻辑（这一版重写过，别再退回旧写法）
 * =========================================================
 *
 * 第一版的问题：`EXIT_DELTA = 6`（上滚 6px 就恢复）+ `touchmove` 手指上移
 * 12px 就恢复。结果是一次滚动手势里状态能来回翻好几次 ——
 * 手指刚放上去稍微一抖就展开、继续滚又收回，观感是「抽搐」。
 *
 * 现在用三条机制，缺一不可：
 *
 * 1. **对称滞回**：进入与退出各需累计 `THRESHOLD`（60px），不是「一个
 *    小反向就恢复」。方向一反转，反向累加器立即归零 —— 也就是说必须
 *    **持续**朝同一方向滑够 60px 才切换，这正是「看接下来的动作行为」，
 *    而不是「瞄一眼就下结论」。
 *
 * 2. **冷却期**：一次切换后 `COOLDOWN` 毫秒内不再切换。滚动惯性衰减时
 *    的微小抖动、以及在惯性中触碰屏幕造成的滚动停止，都会被这条吃掉。
 *
 * 3. **程序化滚动抑制**：`resetDock()` 之后的 `HOLD_MS` 内强制 `rest`。
 *    点目录跳转用 `scroll-behavior: smooth`，动画期间持续产生向下滚动
 *    事件 —— 不抑制的话「点目录跳到下一节」会在动画结束后变成隐藏态
 *    （用户反馈的现象：向上跳展开、向下跳隐藏）。
 *
 * 只在**滚动**上判定，不再挂 `touchstart` / `touchmove`：
 * 触摸本身不携带意图，滚动位移才携带。旧实现把手势当信号，
 * 必然出现「手指刚放上去就展开」。
 *
 * ---------- 为什么是模块级单例 ----------
 *
 * `SiteHeader` 与 `MobileDock` 必须看到**同一个**状态。如果每处各建一份，
 * 就会各自注册滚动监听、各自算一遍，极容易算出两个不同结论
 * （典型的 bug：页头藏了、胶囊没缩，或者反过来）。
 */

import { readonly, ref } from 'vue'

/** 顶部保护带：小于这个滚动量永远保持 rest。 */
const TOP_GUARD = 160
/** 进入 / 退出阅读态各需的累计滚动距离（**对称**，不要单边调小）。 */
const THRESHOLD = 60
/** 一次切换后的静默期，吃掉惯性与抖动造成的来回翻转。 */
const COOLDOWN = 420
/** `resetDock()` 默认抑制时长，要盖住平滑滚动的动画（约 300~450ms）。 */
const HOLD_MS = 700

export type DockMode = 'rest' | 'reading'

const mode = ref<DockMode>('rest')
/** 是否已经滚过半屏（决定「回到顶部」是否可用）。 */
const scrolled = ref(false)

let lastY = 0
/** 向下 / 向上两个独立累加器：方向反转即清零，保证「持续」而不是「净位移」。 */
let downAccum = 0
let upAccum = 0
let listening = false
let frame = 0
/** 冷却期截止时间戳。 */
let cooldownUntil = 0
/** 强制 rest 的截止时间戳（程序化滚动期间）。 */
let holdUntil = 0

/** 是否贴底（留 2px 容差，与 `useActiveAnchor` 同一口径）。 */
function atBottom(): boolean {
  const doc = document.documentElement
  return window.innerHeight + window.scrollY >= doc.scrollHeight - 2
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function switchTo(next: DockMode): void {
  mode.value = next
  cooldownUntil = now() + COOLDOWN
  downAccum = 0
  upAccum = 0
}

function update(): void {
  const y = window.scrollY
  const delta = y - lastY
  const t = now()

  scrolled.value = y > window.innerHeight * 0.5

  // 程序化滚动（点目录 / 回到顶部）期间：强行 rest 且不累计
  if (t < holdUntil) {
    if (mode.value !== 'rest') switchTo('rest')
    downAccum = 0
    upAccum = 0
    lastY = y
    return
  }

  // 顶部保护带：进页面、跳转后回顶都落在这里
  if (y <= TOP_GUARD) {
    if (mode.value !== 'rest') {
      // 回顶是「用户主动找东西」，不受冷却期约束，立刻展开
      mode.value = 'rest'
      cooldownUntil = 0
    }
    downAccum = 0
    upAccum = 0
    lastY = y
    return
  }

  const cooling = t < cooldownUntil

  if (delta > 0) {
    // 向下：累加；上滚累加器清零（方向反转 = 重新开始计数）
    downAccum += delta
    upAccum = 0
    if (!cooling && mode.value === 'rest' && downAccum >= THRESHOLD && !atBottom()) {
      switchTo('reading')
    }
  } else if (delta < 0) {
    upAccum += -delta
    downAccum = 0
    if (!cooling && mode.value === 'reading' && upAccum >= THRESHOLD) {
      switchTo('rest')
    }
  }

  lastY = y
}

/** rAF 合并：同一帧内多次滚动只算一次。 */
function schedule(): void {
  if (frame) return
  frame = window.requestAnimationFrame(() => {
    frame = 0
    update()
  })
}

/**
 * 强制回到 rest（并保持一小段时间）。
 *
 * 用于：路由切换、点击目录跳转、打开任意浮层、回到顶部。
 * 这些时刻用户正在「找东西」，chrome 必须立刻可见；
 * 且随后的平滑滚动不能把它重新判定成 reading。
 *
 * @param holdMs 抑制时长，默认 700ms（盖住平滑滚动动画）。
 */
export function resetDock(holdMs = HOLD_MS): void {
  mode.value = 'rest'
  downAccum = 0
  upAccum = 0
  cooldownUntil = 0
  holdUntil = now() + holdMs
  if (typeof window !== 'undefined') lastY = window.scrollY
}

/**
 * 订阅阅读态。
 *
 * 可以放心地在多个组件里各调一次：状态与滚动监听都是模块级单例，
 * 第二次调用只是多读一个 `ref`，不会重复绑定事件。
 */
export function useDockState() {
  if (!listening && typeof window !== 'undefined') {
    listening = true
    lastY = window.scrollY
    window.addEventListener('scroll', schedule, { passive: true })
    // 首次进入时算一遍：从上一页带着滚动位置过来时状态要对
    update()
  }

  return {
    /** 当前形态。 */
    mode: readonly(mode),
    /** 是否已滚过半屏。 */
    scrolled: readonly(scrolled),
    reset: resetDock,
  }
}
