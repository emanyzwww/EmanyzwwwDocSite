import { describe, expect, it } from 'vitest'

import {
  compactNumber,
  fallbackPreview,
  isCacheFresh,
  normalizeForCache,
  parseBilibiliVideo,
  parseGitHubRepo,
  previewCacheKey,
  type PreviewCacheEntry,
} from '../.vitepress/theme/support/link-preview/core'

/**
 * 链接预览的纯函数层。
 *
 * 只测「判断错了会直接变成错误行为」的部分：
 * provider 匹配（拼错域名就永远降级）、缓存键（串键 = 错数据）、
 * 缓存新鲜度（过期判断错 = 要么狂发请求要么永远显示旧数据）、
 * 两个平台的 URL 解析。
 *
 * fetch 与 UI 不在这里测：它们依赖浏览器运行时（CSP、DOM、Vue）。
 */

describe('parseGitHubRepo', () => {
  it('标准仓库链接', () => {
    expect(parseGitHubRepo('https://github.com/vuejs/core')).toEqual({
      owner: 'vuejs',
      repo: 'core',
    })
  })

  it('带 www 前缀也能识别', () => {
    expect(parseGitHubRepo('https://www.github.com/vuejs/core')).toEqual({
      owner: 'vuejs',
      repo: 'core',
    })
  })

  it('仓库子路径（issues / blob / pull）仍按 owner/repo 取仓库卡', () => {
    expect(parseGitHubRepo('https://github.com/vuejs/core/issues/1234')).toEqual({
      owner: 'vuejs',
      repo: 'core',
    })
  })

  it('.git 后缀的 clone 链接归一化掉', () => {
    expect(parseGitHubRepo('https://github.com/vuejs/core.git')).toEqual({
      owner: 'vuejs',
      repo: 'core',
    })
  })

  it('个人主页（单段路径）不是仓库', () => {
    expect(parseGitHubRepo('https://github.com/vuejs')).toBeNull()
  })

  it('一级功能页不是仓库', () => {
    expect(parseGitHubRepo('https://github.com/features/security')).toBeNull()
    expect(parseGitHubRepo('https://github.com/trending')).toBeNull()
  })

  it('非 github.com 域名不匹配', () => {
    expect(parseGitHubRepo('https://gist.github.com/somebody/abc')).toBeNull()
    expect(parseGitHubRepo('https://gitlab.com/group/repo')).toBeNull()
  })

  it('非法 URL 返回 null 而不是抛错', () => {
    expect(parseGitHubRepo('not a url')).toBeNull()
  })
})

describe('parseBilibiliVideo', () => {
  it('标准视频链接', () => {
    expect(parseBilibiliVideo('https://www.bilibili.com/video/BV1xx411c7mD')).toEqual({
      bvid: 'BV1xx411c7mD',
    })
  })

  it('带查询参数仍能解析', () => {
    expect(
      parseBilibiliVideo('https://www.bilibili.com/video/BV1xx411c7mD?spm_id_from=333.337'),
    ).toEqual({ bvid: 'BV1xx411c7mD' })
  })

  it('非视频路径 / 非本站域名不匹配', () => {
    expect(parseBilibiliVideo('https://www.bilibili.com/anime/123')).toBeNull()
    expect(parseBilibiliVideo('https://example.com/video/BV1xx411c7mD')).toBeNull()
  })
})

describe('previewCacheKey / normalizeForCache', () => {
  it('同 URL 归一化后同键（大小写 / 尾斜杠 / 跟踪参数不产生重复请求）', () => {
    const a = previewCacheKey('github', 'https://github.com/vuejs/core/')
    const b = previewCacheKey('github', 'https://github.com/vuejs/core?utm_source=x')
    expect(a).toBe(b)
  })

  it('不同 provider 同 URL 不同键（互不串数据）', () => {
    const a = previewCacheKey('github', 'https://github.com/vuejs/core')
    const b = previewCacheKey('external', 'https://github.com/vuejs/core')
    expect(a).not.toBe(b)
  })

  it('键带统一命名空间', () => {
    expect(previewCacheKey('github', 'https://github.com/a/b')).toMatch(/^link-preview:github:/)
  })

  it('非 http(s) 输入不抛错（URL 解析失败退化为小写原串）', () => {
    expect(normalizeForCache('not a url')).toBe('not a url')
  })
})

describe('isCacheFresh', () => {
  const NOW = 1_000_000_000
  const entry = (ageMs: number): PreviewCacheEntry => ({ at: NOW - ageMs, data: null })

  it('TTL 内新鲜', () => {
    expect(isCacheFresh(entry(1000), NOW, 60_000)).toBe(true)
  })

  it('超过 TTL 过期', () => {
    expect(isCacheFresh(entry(61_000), NOW, 60_000)).toBe(false)
  })

  it('恰好等于 TTL 时已过期（< 严格比较）', () => {
    expect(isCacheFresh(entry(60_000), NOW, 60_000)).toBe(false)
  })

  it('负 TTL = 禁用缓存，永远过期', () => {
    expect(isCacheFresh(entry(0), NOW, -1)).toBe(false)
  })

  it('空条目 / 畸形条目安全返回 false', () => {
    expect(isCacheFresh(null, NOW, 60_000)).toBe(false)
    expect(isCacheFresh(undefined, NOW, 60_000)).toBe(false)
    expect(isCacheFresh({ data: null } as unknown as PreviewCacheEntry, NOW, 60_000)).toBe(false)
  })
})

describe('compactNumber', () => {
  it('千以下原样', () => {
    expect(compactNumber(0)).toBe('0')
    expect(compactNumber(42)).toBe('42')
    expect(compactNumber(999)).toBe('999')
  })

  it('千到百万缩写成 k（一位小数，>100k 取整）', () => {
    expect(compactNumber(1234)).toBe('1.2k')
    expect(compactNumber(12_300)).toBe('12.3k')
    expect(compactNumber(123_456)).toBe('123k')
  })

  it('百万以上缩写成 M', () => {
    expect(compactNumber(1_234_567)).toBe('1.2M')
    expect(compactNumber(12_345_678)).toBe('12.3M')
    expect(compactNumber(123_456_789)).toBe('123M')
  })

  it('非法输入安全返回 0', () => {
    expect(compactNumber(Number.NaN)).toBe('0')
    expect(compactNumber(-5)).toBe('0')
  })
})

describe('fallbackPreview', () => {
  it('http(s) URL 生成域名兜底卡', () => {
    expect(fallbackPreview('https://www.example.com/path?x=1')).toEqual({
      title: 'example.com',
      description: '',
      site: '',
      icon: 'globe',
      url: 'https://www.example.com/path?x=1',
    })
  })

  it('带 site 时降级卡标明来源站', () => {
    const card = fallbackPreview('https://www.bilibili.com/video/BV1xx411c7mD', 'bilibili')
    expect(card?.site).toBe('bilibili')
    expect(card?.title).toBe('bilibili.com')
  })

  it('www. 前缀剥掉但其它子域名保留', () => {
    expect(fallbackPreview('https://docs.example.org/a')?.title).toBe('docs.example.org')
  })

  it('非 http(s) 协议返回 null（调用方收起卡片）', () => {
    expect(fallbackPreview('mailto:someone@example.com')).toBeNull()
    expect(fallbackPreview('javascript:alert(1)')).toBeNull()
  })

  it('非法 URL 返回 null 而不是抛错', () => {
    expect(fallbackPreview('not a url')).toBeNull()
  })
})
