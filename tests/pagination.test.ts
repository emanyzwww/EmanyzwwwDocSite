import { describe, expect, it } from 'vitest'

import { paginate, pageCount } from '../.vitepress/theme/support/pagination'

/** 分页计算。边界：空列表、单页、越界页码、非整数输入。 */

describe('paginate', () => {
  const items = Array.from({ length: 25 }, (_, index) => index + 1)

  it('取第 1 页', () => {
    const slice = paginate(items, 1, 10)
    expect(slice.items).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(slice.current).toBe(1)
    expect(slice.totalPages).toBe(3)
  })

  it('取最后一页（不足整页）', () => {
    const slice = paginate(items, 3, 10)
    expect(slice.items).toEqual([21, 22, 23, 24, 25])
    expect(slice.current).toBe(3)
  })

  it('页码越界时夹到最后一页', () => {
    expect(paginate(items, 99, 10).current).toBe(3)
  })

  it('页码小于 1 时夹到第 1 页', () => {
    expect(paginate(items, 0, 10).current).toBe(1)
    expect(paginate(items, -5, 10).current).toBe(1)
  })

  it('非法页码回退到第 1 页', () => {
    expect(paginate(items, Number.NaN, 10).current).toBe(1)
  })

  it('空列表仍有 1 页', () => {
    const slice = paginate([], 1, 10)
    expect(slice.items).toEqual([])
    expect(slice.totalPages).toBe(1)
    expect(slice.current).toBe(1)
  })

  it('perPage 为 0 时按 1 处理，不产生 NaN', () => {
    const slice = paginate([1, 2, 3], 1, 0)
    expect(slice.items).toEqual([1])
    expect(slice.totalPages).toBe(3)
  })
})

describe('pageCount', () => {
  it('整除时不多算一页', () => {
    expect(pageCount(20, 10)).toBe(2)
  })

  it('有余数时进位', () => {
    expect(pageCount(21, 10)).toBe(3)
  })

  it('空内容仍返回 1（与 paginate 一致）', () => {
    expect(pageCount(0, 10)).toBe(1)
  })

  it('perPage 非法时不抛错', () => {
    expect(pageCount(5, 0)).toBe(5)
  })

  it('与 paginate 的 totalPages 口径一致', () => {
    for (const total of [0, 1, 9, 10, 11, 25, 100]) {
      const items = Array.from({ length: total }, (_, index) => index)
      expect(pageCount(total, 10)).toBe(paginate(items, 1, 10).totalPages)
    }
  })
})
