import { describe, expect, it, vi } from 'vitest'

import { parseAnchorOffset, scrollToAnchor } from '../.vitepress/theme/support/anchor-scroll'

/**
 * 锚点平滑滚动。
 *
 * 改造前 VitePress 的 `scrollTo()` 只有「距离 < 一屏」才平滑，其余硬跳 ——
 * 而目录的作用恰恰是跨章节跳转，所以实测点目录永远是硬跳。
 * 这里测的是替代实现里最容易偏掉的那部分：**顶部留白**。
 */

describe('parseAnchorOffset', () => {
  it('rem 换算成 px', () => {
    expect(parseAnchorOffset('4.5rem')).toBe(72)
    expect(parseAnchorOffset('5rem', 20)).toBe(100)
  })

  it('px 原样返回', () => {
    expect(parseAnchorOffset('96px')).toBe(96)
    expect(parseAnchorOffset('  64px  ')).toBe(64)
  })

  it('无单位按 px 处理', () => {
    expect(parseAnchorOffset('80')).toBe(80)
  })

  it('calc() 原文回退到 80（自定义属性读到的就是未解析的 calc）', () => {
    // 这是实际会遇到的情况：--anchor-offset 声明为 calc(...)，
    // getComputedStyle 对自定义属性返回原文，不能当数字用
    expect(parseAnchorOffset('calc(var(--header-height) + var(--space-4))')).toBe(80)
  })

  it('空串回退到 80', () => {
    expect(parseAnchorOffset('')).toBe(80)
    expect(parseAnchorOffset('   ')).toBe(80)
  })

  it('非法值回退到 80', () => {
    expect(parseAnchorOffset('abc')).toBe(80)
    expect(parseAnchorOffset('auto')).toBe(80)
  })
})

/**
 * `scrollToAnchor` 的 DOM 行为。
 *
 * 用最小的 document 替身：只提供 `getElementById`，并记录
 * `window.scrollTo` 的调用参数。
 */
describe('scrollToAnchor', () => {
  function setup(options: {
    targetTop?: number
    scrollY?: number
    /** `--anchor-offset` 的原始值 */
    offsetVar?: string
    reducedMotion?: boolean
  }) {
    const {
      targetTop = 1200,
      scrollY = 0,
      offsetVar = '96px',
      reducedMotion = false,
    } = options

    const scrollTo = vi.fn()

    vi.stubGlobal('window', {
      scrollY,
      scrollTo,
      matchMedia: (query: string) => ({ matches: reducedMotion && query.includes('reduce') }),
    })
    vi.stubGlobal('getComputedStyle', () => ({
      getPropertyValue: () => offsetVar,
    }))
    vi.stubGlobal('document', {
      getElementById: (id: string) =>
        id === 'section'
          ? { getBoundingClientRect: () => ({ top: targetTop - scrollY }) }
          : null,
    })

    return { scrollTo }
  }

  it('扣掉页头留白后滚动', () => {
    const { scrollTo } = setup({ targetTop: 1200, scrollY: 0, offsetVar: '96px' })
    const ok = scrollToAnchor('#section')

    expect(ok).toBe(true)
    // 文档坐标 1200 - 留白 96 = 1104
    expect(scrollTo).toHaveBeenCalledWith({ top: 1104, behavior: 'smooth' })
  })

  it('已在滚动位置时按当前 scrollY 换算（不是绝对 0）', () => {
    const { scrollTo } = setup({ targetTop: 1200, scrollY: 400, offsetVar: '96px' })
    scrollToAnchor('#section')

    // rect.top 相对视口 = 1200 - 400 = 800；800 + scrollY(400) - 96 = 1104
    expect(scrollTo).toHaveBeenCalledWith({ top: 1104, behavior: 'smooth' })
  })

  it('不会滚到负数（目标在文档最顶部时）', () => {
    const { scrollTo } = setup({ targetTop: 20, scrollY: 0, offsetVar: '96px' })
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
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '0px' }))
    vi.stubGlobal('document', { getElementById })

    const ok = scrollToAnchor('#%E4%B8%AD%E6%96%87%E6%A0%87%E9%A2%98')

    expect(ok).toBe(true)
    expect(getElementById).toHaveBeenCalledWith('中文标题')
  })

  it('目标不存在时返回 false（交给浏览器默认行为）', () => {
    setup({})
    expect(scrollToAnchor('#missing')).toBe(false)
  })
})
