import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetDock, resetDockStateForTests, useDockState } from '../.vitepress/theme/composables/useDockState'

/**
 * 移动端「阅读态」状态机。
 *
 * =========================================================
 * 这一组守的是用户报的两个真机问题
 * =========================================================
 *
 * 1.「点完跳转后，它会先滑动一小段，然后再平滑地划过去」
 *    —— 根因在 `overlay.ts`（归位滚动被 smooth 接管），已在那个文件修。
 *
 * 2.「点击跳转之后应该始终展开（页头 + 胶囊），但现在有概率收起来」
 *    —— 这是本文件的主题：`resetDock()` 之后的抑制窗口**不能是固定时长**。
 *    平滑滚动耗时取决于距离与设备（实测跨章节约 750ms），
 *    旧实现写死 700ms，超出那段被当成"读者主动下滚"，chrome 收起。
 *    现在改成"等滚动真正停稳"，下面这些用例把它钉住。
 */

/**
 * 滚动监听器的登记表。
 *
 * ⚠️ 必须是**模块级**，且不要在每个用例里清空后重建注册逻辑：
 * `useDockState` 里的 `listening` 也是模块级单例 —— 它只在第一次调用时
 * 向 `window` 注册一次监听。如果每个用例都换一个"新 window"，
 * 后续用例的监听器注册会被 `listening` 短路，滚动事件就再也派发不到
 * 状态机里（表现为"怎么滚都是 rest"，正是这组用例第一版踩的坑）。
 *
 * 所以这里让所有用例共享同一个登记表，`beforeEach` 里只清空数组内容
 * （登记过的函数引用保持不变，它们读取的是**当时**的 `window.scrollY`，
 * 而 `window` 每个用例都会重新 stub —— 闭包读的是全局，天然跟得上）。
 */
const scrollHandlers: (() => void)[] = []

/** 搭一个最小的滚动环境。 */
function setup(options: { scrollY?: number; innerHeight?: number; scrollHeight?: number } = {}) {
  const { scrollY = 0, innerHeight = 844, scrollHeight = 6000 } = options

  const state = { y: scrollY }
  scrollHandlers.length = 0

  vi.stubGlobal('window', {
    get scrollY() {
      return state.y
    },
    innerHeight,
    requestAnimationFrame: (cb: FrameRequestCallback) => {
      setTimeout(() => cb(0), 0)
      return 1
    },
    addEventListener: (type: string, fn: () => void) => {
      if (type === 'scroll') scrollHandlers.push(fn)
    },
    removeEventListener: vi.fn(),
  })
  vi.stubGlobal('document', {
    documentElement: { scrollHeight },
    body: { style: {} },
  })

  /** 模拟滚动到指定位置并驱动一次状态机更新。 */
  const scrollTo = async (nextY: number): Promise<void> => {
    state.y = nextY
    for (const handler of [...scrollHandlers]) handler()
    // `schedule()` 内部走 rAF（上面 stub 成了 setTimeout 0），等它跑完
    await new Promise((r) => setTimeout(r, 5))
  }

  return { state, scrollTo }
}

describe('resetDock 的抑制窗口', () => {
  beforeEach(() => {
    vi.useRealTimers()
    /*
     * `listening`（是否已注册滚动监听）是模块单例：第一个用例注册后，
     * 后续用例重新 stub 的 window 不会再被注册 —— 滚动事件就派发不进
     * 状态机了。每个用例前重置，让注册逻辑重新走一遍。
     */
    resetDockStateForTests()
  })

  it('调用后立刻是 rest', () => {
    setup()
    const { mode } = useDockState()
    resetDock()
    expect(mode.value).toBe('rest')
  })

  it('抑制期间大幅下滚不会进入 reading', async () => {
    const { scrollTo } = setup()
    const { mode } = useDockState()
    resetDock()

    // 模拟平滑滚动的中间若干帧（每帧间隔远小于 SETTLE_IDLE_MS）
    for (const y of [200, 400, 700, 900, 1100]) {
      await scrollTo(y)
    }

    expect(mode.value).toBe('rest')
  })

  it('关键：抑制要覆盖"超过 700ms 的长距离平滑滚动"', async () => {
    const { scrollTo } = setup()
    const { mode } = useDockState()
    resetDock()

    /*
     * 这是旧实现失败的场景：900ms 的持续下滚。
     * 旧代码 `holdUntil = now() + 700`，越过 700ms 之后累加器开始计入，
     * 连续 60px 就切 reading —— chrome 收起。
     * 新实现只要"还在动"就保持 rest，所以必须一直是 rest。
     */
    const frames = 45 // 45 × 20ms ≈ 900ms
    for (let i = 1; i <= frames; i += 1) {
      await scrollTo(i * 40)
      await new Promise((r) => setTimeout(r, 20))
    }

    expect(mode.value).toBe('rest')
  })

  it('停稳后读者的下一次下滚才进入 reading', async () => {
    const { scrollTo } = setup()
    const { mode } = useDockState()
    resetDock()

    // 先来一段平滑滚动
    for (const y of [200, 500, 800]) {
      await scrollTo(y)
    }
    expect(mode.value).toBe('rest')

    // 静默足够久 → 抑制退出
    await new Promise((r) => setTimeout(r, 250))

    // 现在读者继续下滚，应当能进入 reading
    for (const y of [860, 940, 1020]) {
      await scrollTo(y)
      await new Promise((r) => setTimeout(r, 160))
    }

    expect(mode.value).toBe('reading')
  })

  it('硬上限结束后恢复判定（防止读者立刻接手导致永不退出）', async () => {
    const { scrollTo } = setup()
    const { mode } = useDockState()
    // 用很短的硬上限模拟"撞到上限"
    resetDock(80)

    await scrollTo(1200)
    await new Promise((r) => setTimeout(r, 30))
    await scrollTo(1400)
    // 已经超过 80ms 硬上限
    await new Promise((r) => setTimeout(r, 120))

    for (const y of [1460, 1530]) {
      await scrollTo(y)
      await new Promise((r) => setTimeout(r, 160))
    }

    expect(mode.value).toBe('reading')
  })

  it('目标就在原地（无位移）时，抑制也会靠时间自己退出', async () => {
    const { scrollTo } = setup()
    const { mode } = useDockState()
    resetDock(60)

    // 没有任何位移，等硬上限过去
    await new Promise((r) => setTimeout(r, 150))
    await scrollTo(0)

    // 此时应已退出抑制，继续下滚能进入 reading
    for (const y of [300, 400]) {
      await scrollTo(y)
      await new Promise((r) => setTimeout(r, 160))
    }

    expect(mode.value).toBe('reading')
  })
})
