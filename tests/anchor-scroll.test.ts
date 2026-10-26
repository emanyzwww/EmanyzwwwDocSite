import { beforeEach, describe, expect, it, vi } from 'vitest'

import { requestAnchorScroll, scrollToAnchor } from '../.vitepress/theme/support/anchor-scroll'
import {
  resetOverlayStateForTests,
  acquireScrollLock,
  isScrollLocked,
  onScrollLockRelease,
  releaseScrollLock,
} from '../.vitepress/theme/support/overlay'

/**
 * 锚点平滑滚动。
 *
 * 改造前 VitePress 的 `scrollTo()` 只有「距离 < 一屏」才平滑，其余硬跳 ——
 * 而目录的作用恰恰是跨章节跳转，所以实测点目录永远是硬跳。
 * 这里测的是替代实现里最容易偏掉的那部分：**顶部留白**。
 */

/**
 * 锚点平滑滚动。
 *
 * 改造前 VitePress 的 `scrollTo()` 只有「距离 < 一屏」才平滑，其余硬跳 ——
 * 而目录的作用恰恰是跨章节跳转，所以实测点目录永远是硬跳。
 * 这里测的是替代实现里最容易偏掉的那部分：**顶部留白**。
 *
 * 偏移来源是 `scroll-padding-top` 的解析值（不再解析 `--anchor-offset`
 * 的 calc 原文），因此替身里直接给 `scrollPaddingTop` 一个 px 字符串。
 */

describe('scrollToAnchor', () => {
  function setup(options: {
    targetTop?: number
    scrollY?: number
    /** `scroll-padding-top` 的解析值（px 字符串） */
    offset?: string
    reducedMotion?: boolean
  }) {
    const { targetTop = 1200, scrollY = 0, offset = '96px', reducedMotion = false } = options

    const scrollTo = vi.fn()

    vi.stubGlobal('window', {
      scrollY,
      scrollTo,
      matchMedia: (query: string) => ({ matches: reducedMotion && query.includes('reduce') }),
    })
    vi.stubGlobal('getComputedStyle', () => ({ scrollPaddingTop: offset }))
    vi.stubGlobal('document', {
      getElementById: (id: string) =>
        id === 'section' ? { getBoundingClientRect: () => ({ top: targetTop - scrollY }) } : null,
    })

    return { scrollTo }
  }

  it('扣掉页头留白后滚动', () => {
    const { scrollTo } = setup({ targetTop: 1200, scrollY: 0, offset: '96px' })
    const ok = scrollToAnchor('#section')

    expect(ok).toBe(true)
    // 文档坐标 1200 - 留白 96 = 1104
    expect(scrollTo).toHaveBeenCalledWith({ top: 1104, behavior: 'smooth' })
  })

  it('已在滚动位置时按当前 scrollY 换算（不是绝对 0）', () => {
    const { scrollTo } = setup({ targetTop: 1200, scrollY: 400, offset: '96px' })
    scrollToAnchor('#section')

    // rect.top 相对视口 = 1200 - 400 = 800；800 + scrollY(400) - 96 = 1104
    expect(scrollTo).toHaveBeenCalledWith({ top: 1104, behavior: 'smooth' })
  })

  it('不会滚到负数（目标在文档最顶部时）', () => {
    const { scrollTo } = setup({ targetTop: 20, scrollY: 0, offset: '96px' })
    scrollToAnchor('#section')

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })

  it('减少动效时改为 instant', () => {
    const { scrollTo } = setup({ targetTop: 1200, reducedMotion: true })
    scrollToAnchor('#section')

    expect(scrollTo).toHaveBeenCalledWith({ top: 1104, behavior: 'auto' })
  })

  it('解码百分号编码的锚点', () => {
    const getElementById = vi.fn((id: string) =>
      id === '中文标题' ? { getBoundingClientRect: () => ({ top: 100 }) } : null,
    )
    vi.stubGlobal('window', {
      scrollY: 0,
      scrollTo: vi.fn(),
      matchMedia: () => ({ matches: false }),
    })
    vi.stubGlobal('getComputedStyle', () => ({ scrollPaddingTop: '0px' }))
    vi.stubGlobal('document', { getElementById })

    const ok = scrollToAnchor('#%E4%B8%AD%E6%96%87%E6%A0%87%E9%A2%98')

    expect(ok).toBe(true)
    expect(getElementById).toHaveBeenCalledWith('中文标题')
  })

  it('目标不存在时返回 false（交给浏览器默认行为）', () => {
    setup({})
    expect(scrollToAnchor('#missing')).toBe(false)
  })

  it('scroll-padding-top 非法时回退 80', () => {
    const { scrollTo } = setup({ targetTop: 1200, offset: 'auto' })
    scrollToAnchor('#section')

    // 1200 - 回退值 80 = 1120
    expect(scrollTo).toHaveBeenCalledWith({ top: 1120, behavior: 'smooth' })
  })
})

/**
 * 滚动锁与锚点跳转的交互。
 *
 * =========================================================
 * 这一组守的是一个真机 bug
 * =========================================================
 *
 * 现象：手机上点目录里的标题「经常性失效」，PC 完全复现不出来。
 *
 * 根因（用 iPhone UA 在 headless Chrome 里必现）：
 * 移动端目录是浮层，点目录项时浮层还开着 → 它持着滚动锁。
 * `acquireScrollLock()` 在 iOS 上会额外把 `body` 固定住：
 *
 * ```js
 * body.style.position = 'fixed'
 * body.style.top = `-${savedScrollY}px`
 * ```
 *
 * body 一固定，`window.scrollTo()` **完全无效**，连 `location.hash = x`
 * 触发的原生滚动也被吞掉 —— 且不报错。等浮层关掉、锁释放时，
 * 那次滚动请求早已作废。PC 端目录在侧栏、不持锁，所以永远正常。
 *
 * 修法：锁定期间发起的跳转**排队**，等 `lockCount` 归零再执行。
 * 下面这些用例就是那条契约。
 */
describe('滚动锁与锚点排队', () => {
  /*
   * 每个用例前重置模块级状态。
   *
   * `overlay.ts` 的锁计数与订阅者是**模块单例**（浏览器里全站共用一把锁，
   * 这是刻意的）。但同一进程里跑多个用例时，上一个用例留下的计数会污染
   * 下一个 —— 表现为第一个断言就莫名其妙失败。
   * 有 `beforeEach` 才能让每条断言独立成立。
   */
  beforeEach(() => {
    resetOverlayStateForTests()
    /*
     * `requestAnchorScroll` 用 rAF 把滚动推到下一帧（那时解锁后的布局才稳定）。
     * 测试环境没有这个全局，补一个立即执行版本 —— 断言关心的是
     * "有没有滚 / 滚到哪"，不是"哪一帧滚"。
     */
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const handle = setTimeout(() => cb(0), 0)
      return handle as unknown as number
    })
  })

  /**
   * 搭一个最小的浏览器环境，让 `overlay.ts` 的锁定逻辑可以跑。
   *
   * 需要 `document.documentElement` / `document.body`（都有 `style` 对象）、
   * `window.scrollY`、以及 `window.scrollTo`。
   */
  function setupBrowser() {
    const scrollTo = vi.fn()
    const makeEl = () => ({ style: {} })
    const html = makeEl()
    const body = makeEl()

    vi.stubGlobal('window', {
      scrollY: 0,
      scrollTo,
      matchMedia: () => ({ matches: false }),
      setTimeout: globalThis.setTimeout,
    })
    vi.stubGlobal('document', {
      documentElement: html,
      body,
      getElementById: (id: string) =>
        id === 'section' ? { getBoundingClientRect: () => ({ top: 1200 }) } : null,
    })
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0)', maxTouchPoints: 0 })
    vi.stubGlobal('getComputedStyle', () => ({ scrollPaddingTop: '80px' }))

    return { scrollTo, html, body }
  }

  it('未持锁时立刻滚动', () => {
    const { scrollTo } = setupBrowser()
    const ok = requestAnchorScroll('#section')

    expect(ok).toBe(true)
    // 文档坐标 1200 - 留白 80 = 1120
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith({ top: 1120, behavior: 'smooth' })
  })

  it('持锁时**不**立刻滚动，而是排队', () => {
    const { scrollTo } = setupBrowser()
    acquireScrollLock()

    const ok = requestAnchorScroll('#section')

    expect(ok).toBe(true)
    // 关键：锁着的时候一次都不能滚（滚了也是白滚，iOS 上还会被吞）
    expect(scrollTo).not.toHaveBeenCalled()

    releaseScrollLock()
  })

  it('锁释放后，排队的跳转才真正执行', async () => {
    const { scrollTo } = setupBrowser()
    acquireScrollLock()
    requestAnchorScroll('#section')
    expect(scrollTo).not.toHaveBeenCalled()

    releaseScrollLock()
    // 实现里用 rAF 把滚动推到下一帧
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(scrollTo).toHaveBeenCalledWith({ top: 1120, behavior: 'smooth' })
  })

  it('多个浮层叠加时，要等**全部**释放才跳（引用计数）', async () => {
    const { scrollTo } = setupBrowser()
    acquireScrollLock() // 抽屉
    acquireScrollLock() // 目录

    requestAnchorScroll('#section')
    releaseScrollLock() // 只关了一个，锁还持有
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(scrollTo).not.toHaveBeenCalled()

    releaseScrollLock() // 归零
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(scrollTo).toHaveBeenCalledTimes(1)
  })

  it('目标不存在时不排队，直接返回 false', () => {
    setupBrowser()
    acquireScrollLock()

    expect(requestAnchorScroll('#missing')).toBe(false)

    releaseScrollLock()
  })

  it('isScrollLocked 反映引用计数', () => {
    setupBrowser()
    expect(isScrollLocked()).toBe(false)

    acquireScrollLock()
    expect(isScrollLocked()).toBe(true)

    acquireScrollLock()
    releaseScrollLock()
    expect(isScrollLocked()).toBe(true) // 还有一个

    releaseScrollLock()
    expect(isScrollLocked()).toBe(false)
  })

  it('onScrollLockRelease 只触发一次（一次性订阅）', () => {
    setupBrowser()
    const listener = vi.fn()
    onScrollLockRelease(listener)

    acquireScrollLock()
    releaseScrollLock()
    expect(listener).toHaveBeenCalledTimes(1)

    // 再次获取/释放不应该再通知它
    acquireScrollLock()
    releaseScrollLock()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('取消订阅后不会被通知', () => {
    setupBrowser()
    const listener = vi.fn()
    const off = onScrollLockRelease(listener)
    off()

    acquireScrollLock()
    releaseScrollLock()

    expect(listener).not.toHaveBeenCalled()
  })
})
