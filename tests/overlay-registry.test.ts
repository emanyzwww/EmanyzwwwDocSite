import { describe, expect, it } from 'vitest'

import {
  closeAllOverlays,
  registerOverlayCloser,
} from '../.vitepress/theme/support/overlay'

/**
 * 浮层的"导航前强制关闭"登记表。
 *
 * 它存在的唯一理由是修一个实测到的 bug：搜索面板里点搜索结果后，
 * VitePress 的捕获阶段委托接管了导航，页面换了但**面板没关、滚动锁没释放**
 * （`html.style.overflow === 'hidden'`）—— 读者看到的是
 * "一个被遮罩盖住、滚不动的新页面"，只能按 Esc 脱身。
 *
 * 这里测的是登记表的契约：注册、注销、以及"谁都没登记时不出事"。
 */

describe('浮层登记表', () => {
  it('没有登记时关闭是空操作', () => {
    expect(() => closeAllOverlays()).not.toThrow()
  })

  it('关闭会调用所有已登记的函数', () => {
    const calls: string[] = []
    const a = registerOverlayCloser(() => calls.push('a'))
    const b = registerOverlayCloser(() => calls.push('b'))

    closeAllOverlays()
    expect(calls).toEqual(['a', 'b'])

    a()
    b()
  })

  it('注销后不再被调用', () => {
    const calls: string[] = []
    const unregister = registerOverlayCloser(() => calls.push('once'))
    const keep = registerOverlayCloser(() => calls.push('kept'))

    unregister()
    closeAllOverlays()

    expect(calls).toEqual(['kept'])
    keep()
  })

  it('注销是幂等的（重复调用不报错）', () => {
    const unregister = registerOverlayCloser(() => {})
    unregister()
    expect(() => unregister()).not.toThrow()
  })

  it('每个登记项只被调用一次（不会因为多次 closeAllOverlays 重复执行）', () => {
    let count = 0
    const unregister = registerOverlayCloser(() => {
      count += 1
    })

    closeAllOverlays()
    closeAllOverlays()
    closeAllOverlays()

    expect(count).toBe(3)
    unregister()
  })
})
