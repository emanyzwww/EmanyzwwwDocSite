import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  dismiss,
  hoverLink,
  setLinkPreviewProviders,
  unhoverLink,
  useLinkPreview,
} from '../.vitepress/theme/composables/useLinkPreview'
import type { LinkPreview, LinkProvider } from '../.vitepress/theme/support/link-preview/core'
import { shouldPreviewLink, type LinkTargetFacts } from '../.vitepress/theme/support/link-preview/gate'

/**
 * 链接预览的**入口判定**与**悬浮状态机**。
 *
 * 守的是两个真实 bug：
 *
 * 1. 图片链接（`<a data-lightbox>`，指向 `.png` 原图）被当成普通链接：
 *    悬浮时先亮骨架、拿不到数据再收起 —— 表现为「卡片一闪而过」。
 *    判定规则在 `shouldPreviewLink`（纯函数），这里逐条钉住；
 * 2. 站内链接指向非文章（资源页 / 404 / 图片）时同样会闪：
 *    `provider.peek()` 同步返回 `null` = 确定没有卡，**连定时器都不排**。
 *
 * 不测真实 provider 与网络：`useLinkPreview` 支持注入 provider 列表，
 * 这正是为单测留的口子（`setLinkPreviewProviders`）。
 */

const state = useLinkPreview()

/** 造一个够 `hoverLink` 用的锚点（只用到 `href` 与矩形）。 */
function anchor(href: string): HTMLAnchorElement {
  return {
    href,
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 10, height: 10 }),
  } as unknown as HTMLAnchorElement
}

const CARD: LinkPreview = {
  title: '文章标题',
  description: '摘要',
  meta: '2026-10-28',
  site: '',
  url: 'https://example.com/post/',
}

/** 造一个 provider；默认命中一切、fetch 直接给卡。 */
function provider(overrides: Partial<LinkProvider> = {}): LinkProvider {
  return { id: 'fake', match: () => true, fetch: async () => CARD, ...overrides }
}

beforeEach(() => {
  dismiss()
  setLinkPreviewProviders([])
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('shouldPreviewLink（要不要弹卡）', () => {
  const facts = (overrides: Partial<LinkTargetFacts> = {}): LinkTargetFacts => ({
    href: 'https://example.com/post/',
    rawHref: 'https://example.com/post/',
    inProse: true,
    inEmbed: false,
    isLightbox: false,
    ...overrides,
  })

  it('正文里的普通 http(s) 链接：弹', () => {
    expect(shouldPreviewLink(facts())).toBe(true)
    expect(
      shouldPreviewLink(facts({ href: 'http://localhost:4173/x', rawHref: '/x' })),
    ).toBe(true)
  })

  it('图片链接（data-lightbox）：不弹 —— 回归「卡片闪一下」', () => {
    /*
     * 真实的锚点是构建期产出的：
     * <a class="prose-media__link" href="/assets/media/orig/xxx.png" data-lightbox="true">
     * 它的悬浮反馈是右下角「可放大」角标，不是预览卡。
     */
    expect(
      shouldPreviewLink(
        facts({
          href: 'https://example.com/assets/media/orig/125a7d93404b.png',
          rawHref: '/assets/media/orig/125a7d93404b.png',
          isLightbox: true,
        }),
      ),
    ).toBe(false)
  })

  it('页内锚点：不弹（目标就在眼前）', () => {
    expect(
      shouldPreviewLink(
        facts({ href: 'https://example.com/post/#fn1', rawHref: '#fn1' }),
      ),
    ).toBe(false)
  })

  it('非 http(s)：不弹', () => {
    expect(
      shouldPreviewLink(facts({ href: 'mailto:a@b.c', rawHref: 'mailto:a@b.c' })),
    ).toBe(false)
    expect(
      shouldPreviewLink(facts({ href: 'javascript:void(0)', rawHref: 'javascript:void(0)' })),
    ).toBe(false)
  })

  it('嵌入卡内部的链接：不弹（卡片本身已是完整信息）', () => {
    expect(shouldPreviewLink(facts({ inEmbed: true }))).toBe(false)
  })

  it('正文之外（页头 / 侧栏 / 页脚）：不弹', () => {
    expect(shouldPreviewLink(facts({ inProse: false }))).toBe(false)
  })

  it('没有 href 属性 / href 未被解析：不弹', () => {
    expect(shouldPreviewLink(facts({ href: '', rawHref: null }))).toBe(false)
    expect(shouldPreviewLink(facts({ href: '', rawHref: '' }))).toBe(false)
  })
})

describe('hoverLink（同步 peek 门禁）', () => {
  it('peek 返回 null：不出卡、不亮骨架、不排定时器、不发请求', async () => {
    const fetchSpy = vi.fn(async () => CARD)
    setLinkPreviewProviders([provider({ peek: () => null, fetch: fetchSpy })])

    hoverLink(anchor('https://example.com/assets/photo.png'))
    await vi.advanceTimersByTimeAsync(1000)

    expect(state.visible.value).toBe(false)
    expect(state.preview.value).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('peek 返回数据：延迟结束直接出卡，不进骨架态、不发请求', async () => {
    const fetchSpy = vi.fn(async () => CARD)
    setLinkPreviewProviders([provider({ peek: () => CARD, fetch: fetchSpy })])

    hoverLink(anchor('https://example.com/post/'))
    await vi.advanceTimersByTimeAsync(299)
    // 300ms 进入延迟仍然有效：扫过链接不弹卡
    expect(state.visible.value).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(state.visible.value).toBe(true)
    expect(state.preview.value).toEqual(CARD)
    expect(state.pending.value).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('没有 peek 的 provider：走 fetch，先骨架后数据', async () => {
    let resolveFetch: (value: LinkPreview | null) => void = () => {}
    const gate = new Promise<LinkPreview | null>((resolve) => {
      resolveFetch = resolve
    })
    setLinkPreviewProviders([provider({ fetch: () => gate })])

    hoverLink(anchor('https://example.com/x'))
    await vi.advanceTimersByTimeAsync(300)

    expect(state.visible.value).toBe(true)
    expect(state.pending.value).toBe(true) // 骨架：真的要等网络才允许亮
    expect(state.preview.value).toBeNull()

    resolveFetch(CARD)
    await vi.advanceTimersByTimeAsync(0)
    expect(state.preview.value).toEqual(CARD)
    expect(state.pending.value).toBe(false)
  })

  it('peek 抛错时退回 fetch 路径，不炸掉悬浮', async () => {
    setLinkPreviewProviders([
      provider({
        peek: () => {
          throw new Error('boom')
        },
      }),
    ])

    hoverLink(anchor('https://example.com/x'))
    await vi.advanceTimersByTimeAsync(300)

    expect(state.visible.value).toBe(true)
    expect(state.preview.value).toEqual(CARD)
  })

  it('延迟内移出：定时器被取消，卡片从不出现', async () => {
    setLinkPreviewProviders([provider({ peek: () => CARD })])

    hoverLink(anchor('https://example.com/post/'))
    await vi.advanceTimersByTimeAsync(100)
    unhoverLink()
    await vi.advanceTimersByTimeAsync(1000)

    expect(state.visible.value).toBe(false)
    expect(state.preview.value).toBeNull()
  })

  it('已出卡后移到「确定没有卡」的链接：离开定时器必须活到触发（卡片要收起）', async () => {
    /*
     * 回归：`hoverLink` 曾经在判定之前就 `clearTimers()`，
     * 于是鼠标从出卡的链接 A 移到 peek 说 null 的链接 B 时，
     * A 排下的 200ms 离开定时器被清掉 —— 卡片永远挂在屏幕上。
     */
    const matched = provider({
      match: (href) => href.includes('/post/'),
      peek: () => CARD,
    })
    const nothing = provider({
      match: (href) => href.endsWith('.png'),
      peek: () => null,
    })
    setLinkPreviewProviders([matched, nothing])

    hoverLink(anchor('https://example.com/post/'))
    await vi.advanceTimersByTimeAsync(300)
    expect(state.visible.value).toBe(true)

    // 离开 A（鼠标移出 → 委托里的 unhoverLink），紧接着进入「没有卡」的 B
    unhoverLink()
    hoverLink(anchor('https://example.com/assets/photo.png'))
    await vi.advanceTimersByTimeAsync(500)

    expect(state.visible.value).toBe(false)
  })

  it('非 http(s) 的 href 直接忽略（兜底，PageShell 已先筛一遍）', async () => {
    const fetchSpy = vi.fn(async () => CARD)
    setLinkPreviewProviders([provider({ fetch: fetchSpy })])

    hoverLink(anchor('mailto:someone@example.com'))
    await vi.advanceTimersByTimeAsync(1000)

    expect(state.visible.value).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
