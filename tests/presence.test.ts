import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { nextTick, ref } from 'vue'

import { EXIT_MS, usePresence } from '../.vitepress/theme/composables/usePresence'

/**
 * 浮层进出状态机。
 *
 * 这是全站退出动画的地基：`v-if` 从 `open` 改挂 `present` 之后，
 * **DOM 的摘除时机就由它决定**。写错的两个方向后果都很严重：
 *
 * - 太早摘 → 退出动画只播半帧（或一帧都没有）；
 * - 太晚摘 → 元素已经不可见却还在树上拦截点击，表现为"浮层关不掉"。
 *
 * 所以这里的测试重点不是"动画好不好看"，而是**时机与清理**。
 */

describe('usePresence', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('初始就打开时 present 为 true', () => {
    const open = ref(true)
    const { present, exiting } = usePresence(open)

    expect(present.value).toBe(true)
    expect(exiting.value).toBe(false)
  })

  it('初始关闭时 present 为 false', () => {
    const open = ref(false)
    const { present } = usePresence(open)

    expect(present.value).toBe(false)
  })

  it('打开时立刻 present（不等动画）', async () => {
    const open = ref(false)
    const { present, exiting } = usePresence(open)

    open.value = true
    await nextTick()

    expect(present.value).toBe(true)
    expect(exiting.value).toBe(false)
  })

  it('关闭时先进入 exiting，present 仍为 true', async () => {
    const open = ref(true)
    const { present, exiting } = usePresence(open)

    open.value = false
    await nextTick()

    // 关键：DOM 还在，退出动画才有地方播
    expect(present.value).toBe(true)
    expect(exiting.value).toBe(true)
  })

  it('等够 EXIT_MS 后 present 变 false、exiting 复位', async () => {
    const open = ref(true)
    const { present, exiting } = usePresence(open)

    open.value = false
    await nextTick()

    // 差一点点：还没到
    vi.advanceTimersByTime(EXIT_MS - 10)
    await nextTick()
    expect(present.value).toBe(true)
    expect(exiting.value).toBe(true)

    // 越过 EXIT_MS + 余量
    vi.advanceTimersByTime(100)
    await nextTick()
    expect(present.value).toBe(false)
    expect(exiting.value).toBe(false)
  })

  it('退出途中重新打开会取消移除', async () => {
    const open = ref(true)
    const { present, exiting } = usePresence(open)

    open.value = false
    await nextTick()
    expect(exiting.value).toBe(true)

    // 退出动画播到一半又打开了（读者快速连点）
    open.value = true
    await nextTick()
    expect(present.value).toBe(true)
    expect(exiting.value).toBe(false)

    // 即使原来的定时器到点，也不能把元素摘掉
    vi.advanceTimersByTime(1000)
    await nextTick()
    expect(present.value).toBe(true)
  })

  it('从未渲染过时关闭不会产生多余退出', async () => {
    const open = ref(false)
    const { present, exiting } = usePresence(open)

    open.value = false
    await nextTick()

    // 本来就没渲染，不该进入 exiting（否则会白留一段时间）
    expect(present.value).toBe(false)
    expect(exiting.value).toBe(false)
  })

  it('支持 getter 形式（不要求是 ref）', async () => {
    const open = ref(false)
    const { present } = usePresence(() => open.value)

    open.value = true
    await nextTick()
    expect(present.value).toBe(true)
  })

  it('自定义时长会被使用', async () => {
    const open = ref(true)
    const { present } = usePresence(open, 400)

    open.value = false
    await nextTick()

    vi.advanceTimersByTime(EXIT_MS + 100)
    await nextTick()
    // 还没到自定义的 400ms
    expect(present.value).toBe(true)

    vi.advanceTimersByTime(400)
    await nextTick()
    expect(present.value).toBe(false)
  })

  it('导出值与 CSS 的 --duration-exit 一致', () => {
    /*
     * 这两个数字**必须相等**（见 usePresence.ts 顶部注释）：
     * CSS 决定动画播多久，TS 决定 DOM 留多久。
     * 用一个断言把这条契约钉住 —— 改了一处忘了另一处时这里会红。
     *
     * tokens.css 里写的是 `--duration-exit: 160ms`。
     */
    expect(EXIT_MS).toBe(160)
  })
})
