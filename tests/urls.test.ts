import { describe, expect, it } from 'vitest'

import { decodePath, toPageUrl } from '../.vitepress/support/urls'

/**
 * 路径换算的回归测试。
 *
 * 这几条断言对应过真实 bug：
 * - 中文标签页的 canonical 未编码，与 sitemap 对不上；
 * - 四处各写一份转换，其中一处漏了结尾斜杠。
 *
 * 重构后文章的 URL 带 frontmatter 的 slug 段（由 `rewrites` 映射），
 * 所以这里直接用「route 路径」作为输入——它才是 `toPageUrl` 的输入口径。
 */

describe('toPageUrl', () => {
  it('把目录式 index.md 转成带结尾斜杠的路径', () => {
    expect(toPageUrl('zh-cn/pages/about/index.md')).toBe('/zh-cn/pages/about/')
    expect(toPageUrl('zh-cn/202610/1901/你好，世界/index.md')).toBe(
      '/zh-cn/202610/1901/%E4%BD%A0%E5%A5%BD%EF%BC%8C%E4%B8%96%E7%95%8C/',
    )
  })

  it('把非 index 的 .md 转成同名路径', () => {
    expect(toPageUrl('zh-cn/pages/about.md')).toBe('/zh-cn/pages/about/')
  })

  it('根级 index.md 转成 /', () => {
    expect(toPageUrl('index.md')).toBe('/')
    expect(toPageUrl('zh-cn/index.md')).toBe('/zh-cn/')
  })

  it('对中文路径做 URL 编码（与 sitemap 保持一致）', () => {
    expect(toPageUrl('zh-cn/pages/tags/随笔/index.md')).toBe(
      '/zh-cn/pages/tags/%E9%9A%8F%E7%AC%94/',
    )
  })

  it('保留路径分隔符，不把 / 编码成 %2F', () => {
    expect(toPageUrl('zh-cn/202610/1901/hello-world/index.md')).not.toContain('%2F')
  })

  it('折叠重复斜杠', () => {
    expect(toPageUrl('zh-cn//pages//about//index.md')).toBe('/zh-cn/pages/about/')
  })
})

describe('decodePath', () => {
  it('把编码后的路径还原成原文', () => {
    expect(decodePath('/zh-cn/pages/tags/%E9%9A%8F%E7%AC%94/')).toBe('/zh-cn/pages/tags/随笔/')
  })

  it('对未编码的路径原样返回', () => {
    expect(decodePath('/zh-cn/pages/tags/随笔/')).toBe('/zh-cn/pages/tags/随笔/')
  })

  it('遇到非法编码不抛错', () => {
    expect(decodePath('/zh-cn/%E4%/')).toBe('/zh-cn/%E4%/')
  })

  it('与 toPageUrl 互逆（编码 → 解码）', () => {
    const original = 'zh-cn/pages/tags/随笔/index.md'
    expect(decodePath(toPageUrl(original))).toBe('/zh-cn/pages/tags/随笔/')
  })
})
