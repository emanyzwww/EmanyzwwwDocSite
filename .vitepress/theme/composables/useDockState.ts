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
 * 判定规则（刻意做得迟钝）：
 * - 顶部 200px 内永远是 `rest` —— 刚进页面不该看到任何东西消失；
 * - 只看向下滚动，且必须累计超过 `ENTER_DELTA`，避免地址栏抖动误触发；
 * - 向上滚动只需要很小的 `EXIT_DELTA` 就恢复 —— 恢复要快，消失要慢；
 * - 停在页底不算阅读（页底通常是页脚/相关链接，用户可能在找东西）。
 *
 * ---------- 为什么是模块级单例 ----------
 *
 * `SiteHeader` 与 `MobileDock` 必须看到**同一个**状态。如果每处各建一份，
 * 就会各自注册滚动监听、各自算一遍，极容易算出两个不同结论
 * （典型的 bug：页头藏了、胶囊没缩，或者反过来）。
 *
 * 因此这里不用 `useScrollEffect`（它绑组件生命周期，组件卸载会摘掉监听，
 * 而这个状态必须比任何单个组件活得久），而是直接挂一个模块级监听，
 * 整个过程只挂一次、永不摘除——页面级单例的常规做法。
 */

import { readonly, ref } from 'vue'

/** 顶部保护带：小于这个滚动量永远保持 rest。 */
const TOP_GUARD = 200
/** 进入阅读态需要的累计下滚距离。 */
const ENTER_DELTA = 24
/** 退出阅读态需要的上滚距离（设小一点，恢复要跟手）。 */
const EXIT_DELTA = 6

export type DockMode = 'rest' | 'reading'

const mode = ref<DockMode>('rest')
/** 是否已经滚过半屏（决定「回到顶部」是否可用）。 */
const scrolled = ref(false)

let lastY = 0
let downAccum = 0
let listening = false
let frame = 0

/** 是否贴底（留 2px 容差，与 `useActiveAnchor` 同一口径）。 */
function atBottom(): boolean {
  const doc = document.documentElement
  return window.innerHeight + window.scrollY >= doc.scrollHeight - 2
}

function update(): void {
  const y = window.scrollY
  const delta = y - lastY

  scrolled.value = y > window.innerHeight * 0.5

  // 顶部保护带：进页面、跳转后回顶都落在这里
  if (y <= TOP_GUARD) {
    mode.value = 'rest'
    downAccum = 0
    lastY = y
    return
  }

  if (delta > 0) {
    // 向下：累计到阈值后进入阅读态。到底时不算——页底通常是页脚
    downAccum += delta
    if (downAccum >= ENTER_DELTA && !atBottom()) mode.value = 'reading'
  } else if (delta < -EXIT_DELTA) {
    // 向上：立刻恢复，不需要累计
    downAccum = 0
    mode.value = 'rest'
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
 * 强制回到 rest。
 *
 * 用于：路由切换、点击目录跳转、打开任意浮层。
 * 这些时刻用户正在「找东西」，chrome 必须立刻可见。
 */
export function resetDock(): void {
  mode.value = 'rest'
  downAccum = 0
  if (typeof window !== 'undefined') lastY = window.scrollY
}

/**
 * 订阅阅读态。
 *
 * 可以放心地在多个组件里各调一次：状态与滚动监听都是模块级单例，
 * 第二次调用只是多读同一个 `ref`，不会重复绑定事件。
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
