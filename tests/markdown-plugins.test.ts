import MarkdownIt from 'markdown-it'
import { describe, expect, it } from 'vitest'

import { extendMarkdown } from '../.vitepress/support/markdown-plugins'

/**
 * 自写扩展语法：`==高亮==` 与 GFM 任务列表。
 *
 * 只用裸 `markdown-it`，不经过 VitePress —— 插件本身与 VitePress 无关，
 * 测的是「这段 Markdown 会变成什么 HTML」，与 `tests/` 只测纯函数的约定一致。
 */

const md = new MarkdownIt({ html: true, linkify: true }).use(extendMarkdown)

/** 渲染并去掉用于断言的换行噪声。 */
const render = (source: string) => md.render(source).trim()

describe('markPlugin（==高亮==）', () => {
  it('把 ==文字== 渲染成 <mark>', () => {
    expect(render('==高亮文本==')).toBe('<p><mark>高亮文本</mark></p>')
  })

  it('支持高亮里套粗体', () => {
    expect(render('==**加粗**==')).toBe('<p><mark><strong>加粗</strong></mark></p>')
  })

  it('支持粗体里套高亮', () => {
    expect(render('**==高亮==**')).toBe('<p><strong><mark>高亮</mark></strong></p>')
  })

  it('支持与删除线互相嵌套', () => {
    expect(render('==~~删除线~~==')).toBe('<p><mark><s>删除线</s></mark></p>')
    expect(render('~~==高亮==~~')).toBe('<p><s><mark>高亮</mark></s></p>')
  })

  it('支持高亮里的行内代码与链接', () => {
    expect(render('==带 `代码` 的高亮==')).toBe('<p><mark>带 <code>代码</code> 的高亮</mark></p>')
    expect(render('[==高亮== 链接](https://a.com)')).toContain('<mark>高亮</mark>')
  })

  it('紧贴中文/字母都能生效', () => {
    expect(render('中文==强调==中文')).toBe('<p>中文<mark>强调</mark>中文</p>')
    expect(render('词==中间==词')).toBe('<p>词<mark>中间</mark>词</p>')
  })

  it('单个等号原样输出（不误伤比较运算）', () => {
    expect(render('a == b')).toBe('<p>a == b</p>')
    expect(render('if (a==b)')).toBe('<p>if (a==b)</p>')
    expect(render('1 == 1')).toBe('<p>1 == 1</p>')
  })

  /*
   * 下面几条是「一行两个比较」的回归用例。
   *
   * 修复前：`x==1 且 y==2` 会渲染成 `x<mark>1 且 y</mark>2`。当时的判据只看
   * "能不能紧贴文字"（`scanDelims(pos, true)`），而文档只承诺过**单个**比较安全，
   * 于是写代码笔记时非常常见的双比较就破了。
   *
   * 现在的判据在 `looksLikeComparison`：`==` 两侧都是 ASCII 词字符时按比较处理。
   */
  it('一行里两个无空格比较不被当成高亮', () => {
    expect(render('x==1 且 y==2')).toBe('<p>x==1 且 y==2</p>')
    expect(render('if (a==b) print(a==b)')).toBe('<p>if (a==b) print(a==b)</p>')
  })

  it('版本号与等式形态原样输出', () => {
    expect(render('版本 v1.2==v1.3 之间')).toBe('<p>版本 v1.2==v1.3 之间</p>')
    expect(render('E=mc==2')).toBe('<p>E=mc==2</p>')
  })

  it('ASCII 高亮仍然可用（标记前留空格）', () => {
    expect(render('这是 ==important== 的')).toBe('<p>这是 <mark>important</mark> 的</p>')
  })

  it('三个等号原样输出（不吞掉字符）', () => {
    expect(render('a === b')).toBe('<p>a === b</p>')
  })

  it('未闭合的 == 原样输出', () => {
    expect(render('==没闭合')).toBe('<p>==没闭合</p>')
  })

  it('不吞掉渲染出的属性（`==高亮=={.red}` 在 VitePress 里会带 class）', () => {
    // 回归：渲染规则曾经硬编码成 `() => '<mark>'`，attrs 插件加的 class 会被丢掉
    expect(render('==高亮==')).toBe('<p><mark>高亮</mark></p>')
    expect(render('==高亮==')).not.toContain('<mark >')
  })

  it('行内代码与代码块里的 == 不参与解析', () => {
    expect(render('`==不是高亮==`')).toBe('<p><code>==不是高亮==</code></p>')
    expect(render('```\na == b\n```')).toContain('a == b')
  })

  it('setext 标题（下一行 ===）不受影响', () => {
    expect(render('标题\n===')).toBe('<h1>标题</h1>')
  })

  it('表格单元格里生效', () => {
    expect(render('| a |\n| --- |\n| ==高亮== |')).toContain('<td><mark>高亮</mark></td>')
  })
})

describe('taskListPlugin（GFM 任务列表）', () => {
  it('勾选与未勾选分别渲染 checked / 无 checked', () => {
    const html = render('- [x] 已完成\n- [ ] 待办')
    expect(html).toContain('type="checkbox" readonly checked')
    expect(html).toContain('type="checkbox" readonly>')
    expect(html).not.toContain('[x]')
    expect(html).not.toContain('[ ]')
  })

  it('用 readonly 而非 disabled（disabled 会让浏览器忽略 accent-color）', () => {
    const html = render('- [x] 已完成')
    expect(html).toContain('readonly')
    expect(html).not.toContain('disabled')
  })

  it('给列表与列表项打上 class', () => {
    const html = render('- [x] 已完成')
    expect(html).toContain('<ul class="contains-task-list">')
    expect(html).toContain('<li class="task-list-item">')
  })

  it('大写 X 同样算已完成', () => {
    expect(render('- [X] 已完成')).toContain('checked')
  })

  it('有序列表里也生效', () => {
    const html = render('1. [x] 第一步\n2. [ ] 第二步')
    expect(html).toContain('<ol class="contains-task-list">')
    expect(html).toContain('checked')
  })

  it('嵌套任务列表生效', () => {
    const html = render('- **任务：**\n  - [x] 子项\n- 普通项')
    expect(html).toContain('contains-task-list')
    expect(html).toContain('<li>普通项</li>')
  })

  it('标记后面的行内语法照常解析', () => {
    const html = render('- [x] ==高亮== 与 `代码`')
    expect(html).toContain('<mark>高亮</mark>')
    expect(html).toContain('<code>代码</code>')
  })

  it('方括号不在行首时不算任务项', () => {
    const html = render('- 前置文字 [x] 不是任务')
    expect(html).not.toContain('checkbox')
    expect(html).toContain('[x]')
  })

  it('普通列表项不受影响', () => {
    expect(render('- 苹果\n- 香蕉')).toBe('<ul>\n<li>苹果</li>\n<li>香蕉</li>\n</ul>')
  })
})
