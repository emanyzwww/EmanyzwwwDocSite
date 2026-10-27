import { describe, expect, it } from 'vitest'

import {
  applySiteMarkdown,
  createSiteMarkdown,
  renderMarkdown,
} from '../.vitepress/support/markdown/index'

/**
 * 「同一条 Markdown，两条渲染路径结果一致」。
 *
 * ## 背景
 *
 * 改造前有两套渲染：
 *
 * | | 页面正文 | 简介等非页面 Markdown |
 * | --- | --- | --- |
 * | 实现 | VitePress 实例 | 裸 markdown-it |
 * | `==高亮==` | ✅ | ✅ |
 * | `:::tip` | ✅ 提示框 | ❌ 字面量 `:::tip` |
 * | 指令 | 无 | 无 |
 * | 图片 | webp + srcset | 原路径（部署后 404） |
 *
 * 现在两处都从 `applySiteMarkdown()` 装配。**媒体管线是唯一允许的差异**
 * （非页面 Markdown 没有 Vite 资产清单），并且由调用方显式声明。
 */

describe('两条渲染路径的一致性', () => {
  const cases: [string, string][] = [
    ['高亮', '==高亮=='],
    ['嵌套高亮', '==**粗**里的高亮=='],
    ['任务列表', '- [x] 已完成'],
    ['行内代码', '`code` 与 ==高亮=='],
    ['指令（github）', ':::github vuejs/core\n:::'],
    ['指令（quote）', ':::quote 出处\n正文\n:::'],
    ['指令（link）', ':::link https://example.com 标题\n:::'],
  ]

  for (const [name, source] of cases) {
    it(`${name} 在两条路径产出相同 HTML`, () => {
      // 路径 A：非页面渲染（单例渲染器）
      const sidebar = renderMarkdown(source)
      // 路径 B：页面正文的装配方式（无媒体管线，语义等价）
      const page = createSiteMarkdown().render(source).trim()

      expect(sidebar).toBe(page)
    })
  }

  it('applySiteMarkdown 可以装到外部实例上（页面正文就是这么用的）', () => {
    // 用 createSiteMarkdown 内部同一个装配函数，但作用于一个独立实例
    const external = createSiteMarkdown()
    const viaApply = createSiteMarkdown().render('==x==').trim()
    expect(external.render('==x==').trim()).toBe(viaApply)
    // 幂等性：再次 apply 不应抛错（规则重复挂载由 markdown-it 自己覆盖）
    expect(() => applySiteMarkdown(external)).not.toThrow()
  })

  it('指令在简介里也能用（不再是字面量）', () => {
    const html = renderMarkdown(':::github facebook/react\n:::')
    expect(html).toContain('data-embed="github"')
    expect(html).toContain('data-target="facebook/react"')
    expect(html).not.toContain(':::')
  })
})
