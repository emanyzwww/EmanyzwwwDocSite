import { describe, expect, it } from 'vitest'

import {
  computeThumb,
  scrollTopForOffset,
  shouldReveal,
  type ScrollMetrics,
  type RevealInput,
} from '../.vitepress/theme/support/scrollbar'

/**
 * 自绘滚动条的几何。
 *
 * 这一层的价值在于**边界**：拇指长度必须永远落在 `[minThumb, track]`
 * 之内，位置必须永远落在 `[0, track - length]` 之内。
 * 只要这两条成立，界面上就不会出现「拇指被页头压住」「拇指长过轨道」
 * 「滚到底还有一截空白」这三类问题。
 */

/** 一个典型长文场景：160px 页头，864px 视口，12000px 文档。 */
const base: ScrollMetrics = {
  viewport: 864,
  content: 12000,
  trackTop: 160,
  trackBottom: 864,
  minThumb: 160,
}

describe('computeThumb 长度', () => {
  it('按「视口 / 文档」比例分配', () => {
    const box = computeThumb(base, 0)
    // 轨道 704px，比例 864/12000 = 0.072 → 50.7px，低于下限，被夹到 160
    expect(box.track).toBe(704)
    expect(box.length).toBe(160)
  })

  it('内容刚好两屏时约等于轨道一半', () => {
    const box = computeThumb({ ...base, content: 1728 }, 0)
    // 864 / 1728 = 0.5 → 352px，高于下限 160
    expect(box.length).toBeCloseTo(352, 5)
  })

  it('永不短于 minThumb —— 这是「不被页头压住」的核心', () => {
    // 文档极长时纯比例会得到几像素，必须被抬到下限
    const box = computeThumb({ ...base, content: 2_000_000 }, 0)
    expect(box.length).toBe(160)
  })

  it('永不长过轨道（内容不足一屏时）', () => {
    const box = computeThumb({ ...base, content: 400 }, 0)
    expect(box.length).toBe(704)
    expect(box.length).toBeLessThanOrEqual(box.track)
  })

  it('minThumb 大于轨道时以轨道为准', () => {
    // 视口 200px、页头 160px → 轨道只有 40px，而下限是 160px
    const box = computeThumb(
      { viewport: 200, content: 5000, trackTop: 160, trackBottom: 200, minThumb: 160 },
      0,
    )
    expect(box.length).toBe(40)
    expect(box.length).toBe(box.track)
  })
})

describe('computeThumb 位置', () => {
  it('顶部时偏移为 0', () => {
    expect(computeThumb(base, 0).offset).toBe(0)
  })

  it('滚到底时 offset + length === track', () => {
    const maxScroll = base.content - base.viewport
    const box = computeThumb(base, maxScroll)
    expect(box.offset + box.length).toBeCloseTo(box.track, 5)
  })

  it('滚动量超出范围时夹住，不会把拇指推出轨道', () => {
    const maxScroll = base.content - base.viewport
    const over = computeThumb(base, maxScroll + 9999)
    const under = computeThumb(base, -9999)
    expect(over.offset + over.length).toBeCloseTo(over.track, 5)
    expect(under.offset).toBe(0)
  })

  it('不可滚动时 offset 为 0（此时应按 visible 隐藏）', () => {
    const box = computeThumb({ ...base, content: 500 }, 0)
    expect(box.maxScroll).toBe(0)
    expect(box.offset).toBe(0)
  })
})

describe('computeThumb 退化场景', () => {
  it('视口比页头还矮时轨道为 0，不产生 NaN', () => {
    const box = computeThumb(
      { viewport: 100, content: 5000, trackTop: 160, trackBottom: 100, minThumb: 160 },
      0,
    )
    expect(box.track).toBe(0)
    expect(box.length).toBe(0)
    expect(box.offset).toBe(0)
    expect(Number.isNaN(box.offset)).toBe(false)
  })

  it('尺寸还没测出来（全 0）时不产生 NaN', () => {
    const box = computeThumb(
      { viewport: 0, content: 0, trackTop: 0, trackBottom: 0, minThumb: 0 },
      0,
    )
    expect(box.length).toBe(0)
    expect(Number.isNaN(box.length)).toBe(false)
  })

  it('非数值输入回落到安全值', () => {
    const box = computeThumb({ ...base, content: Number.NaN }, Number.NaN)
    expect(Number.isNaN(box.offset)).toBe(false)
    expect(Number.isNaN(box.length)).toBe(false)
  })
})

describe('scrollTopForOffset 与 computeThumb 互逆', () => {
  it('任意滚动位置往返一致', () => {
    const maxScroll = base.content - base.viewport
    for (const y of [0, 1, 137, maxScroll / 2, maxScroll - 1, maxScroll]) {
      const box = computeThumb(base, y)
      expect(scrollTopForOffset(box, box.offset)).toBeCloseTo(y, 5)
    }
  })

  it('偏移超出范围时夹到 0 / maxScroll', () => {
    const box = computeThumb(base, 0)
    expect(scrollTopForOffset(box, -5000)).toBe(0)
    expect(scrollTopForOffset(box, 99999)).toBeCloseTo(box.maxScroll, 5)
  })

  it('不可滚动时返回 0', () => {
    const box = computeThumb({ ...base, content: 500 }, 0)
    expect(scrollTopForOffset(box, 123)).toBe(0)
  })
})

/**
 * 自动隐藏策略。
 *
 * 这段逻辑决定「滚动条什么时候在」，直接对应「短页面上一根巨大的长条
 * 常驻右边、很抢视觉」这个问题。默认必须隐藏 —— 所以最关键的一条
 * 是「刚滚过去很久之后，不显示」。
 */
describe('shouldReveal', () => {
  const base: RevealInput = {
    idleFor: 0,
    pointerInside: false,
    dragging: false,
    idleDelay: 1200,
  }

  it('默认隐藏（空闲已超时、指针不在带内、未拖拽）', () => {
    expect(shouldReveal({ ...base, idleFor: 5000 })).toBe(false)
  })

  it('正在滚动时显示', () => {
    expect(shouldReveal({ ...base, idleFor: 0 })).toBe(true)
    expect(shouldReveal({ ...base, idleFor: 1199 })).toBe(true)
  })

  it('刚好到阈值就隐藏（边界不含）', () => {
    expect(shouldReveal({ ...base, idleFor: 1200 })).toBe(false)
  })

  it('指针在揭示带内时即使空闲也显示', () => {
    expect(shouldReveal({ ...base, idleFor: 99999, pointerInside: true })).toBe(true)
  })

  it('拖拽时即使指针离开带子也显示', () => {
    expect(
      shouldReveal({ ...base, idleFor: 99999, pointerInside: false, dragging: true }),
    ).toBe(true)
  })

  it('拖拽且指针也在带内，仍然显示（不重复判断）', () => {
    expect(
      shouldReveal({ ...base, idleFor: 99999, pointerInside: true, dragging: true }),
    ).toBe(true)
  })

  it('空闲时长为 NaN 时按已空闲处理（宁可少显示）', () => {
    expect(shouldReveal({ ...base, idleFor: Number.NaN })).toBe(false)
    // 但强制条件优先于数值有效性
    expect(shouldReveal({ ...base, idleFor: Number.NaN, dragging: true })).toBe(true)
  })

  it('idleDelay 为 0 时只有「正在活动」那一刻算显示', () => {
    expect(shouldReveal({ ...base, idleFor: 0, idleDelay: 0 })).toBe(false)
  })
})
