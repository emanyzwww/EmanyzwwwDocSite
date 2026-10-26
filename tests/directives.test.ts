import MarkdownIt from 'markdown-it'
import { describe, expect, it } from 'vitest'

import { applySiteMarkdown } from '../.vitepress/support/markdown/index'
import { directiveNames } from '../.vitepress/support/markdown/directives/index'
import { getDirective, unknownDirectiveMessage } from '../.vitepress/support/markdown/directives/registry'
import {
  parseDirectiveArgs,
  splitDirectiveLine,
} from '../.vitepress/support/markdown/directives/parse'
import { normalizeRepoSpec, parseGitHubRepo } from '../.vitepress/shared/github'

/**
 * 块级指令系统。
 *
 * 用**真实装配点** `applySiteMarkdown()` 建实例（不是只装指令），
 * 这样测到的就是页面正文会拿到的那套插件组合：
 * 行内高亮 + 任务列表 + 块级指令。
 *
 * 与「页面正文」的唯一差别是没有媒体管线——那条路径的用例在 `media-render.test.ts`。
 */

const md = new MarkdownIt({ html: true, linkify: true })
applySiteMarkdown(md)

const render = (source: string) => md.render(source).trim()

describe('参数解析', () => {
  it('按空白切出位置参数', () => {
    const result = parseDirectiveArgs('quote', '《书名》 作者')
    expect(result).toEqual({
      ok: true,
      args: { name: 'quote', positional: ['《书名》', '作者'], named: {} },
    })
  })

  it('支持 key=value 与引号包裹的值', () => {
    const result = parseDirectiveArgs('figure', 'caption="带 空格 的图注"')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.args.named.caption).toBe('带 空格 的图注')
    expect(result.args.positional).toEqual([])
  })

  it('支持单引号', () => {
    const result = parseDirectiveArgs('figure', "caption='单引号'")
    expect(result.ok && result.args.named.caption).toBe('单引号')
  })

  it('引号未闭合时报错而不是静默吞掉', () => {
    const result = parseDirectiveArgs('figure', 'caption="没闭合')
    expect(result.ok).toBe(false)
  })

  it('重复的具名参数报错', () => {
    const result = parseDirectiveArgs('figure', 'caption="a" caption="b"')
    expect(result.ok).toBe(false)
  })

  it('splitDirectiveLine 只认开标签行', () => {
    expect(splitDirectiveLine(':::github vuejs/core')).toEqual({
      name: 'github',
      rest: 'vuejs/core',
    })
    expect(splitDirectiveLine('  ::: quote 出处  ')).toEqual({ name: 'quote', rest: '出处' })
    expect(splitDirectiveLine('::::github x')).toEqual({ name: 'github', rest: 'x' })
    // 只有冒号的是闭合行；普通文本不是指令
    expect(splitDirectiveLine(':::')).toBeNull()
    expect(splitDirectiveLine(':::123bad')).toBeNull()
    expect(splitDirectiveLine('普通 :::github 不算')).toBeNull()
  })
})

describe('注册表', () => {
  it('内置四个指令都已注册', () => {
    expect(directiveNames()).toEqual(['figure', 'github', 'link', 'quote'])
    expect(getDirective('GitHub')?.name).toBe('github')
  })

  it('未知指令的报错列出可用类型并纠错', () => {
    const message = unknownDirectiveMessage('gihub')
    expect(message).toContain(':::gihub')
    expect(message).toContain('figure / github / link / quote')
    // 编辑距离 1，应该猜得到
    expect(message).toContain('你是不是想写：:::github')
  })

  it('差太远的名字不瞎猜', () => {
    const message = unknownDirectiveMessage('zzzzzzzz')
    expect(message).not.toContain('你是不是想写')
  })
})

describe(':::github', () => {
  it('渲染成一条真链接（基线可用）', () => {
    const html = render(':::github vuejs/core\n:::')
    expect(html).toContain('data-embed="github"')
    expect(html).toContain('data-target="vuejs/core"')
    expect(html).toContain('href="https://github.com/vuejs/core"')
    expect(html).toContain('<strong>vuejs</strong>/core')
  })

  it('接受完整链接与子路径', () => {
    const fromUrl = render(':::github https://github.com/vuejs/core\n:::')
    const fromIssues = render(':::github https://github.com/vuejs/core/issues/1\n:::')
    expect(fromUrl).toContain('data-target="vuejs/core"')
    // 子路径归到仓库，链接本身指向仓库主页（语义正确）
    expect(fromIssues).toContain('data-target="vuejs/core"')
    expect(fromIssues).toContain('href="https://github.com/vuejs/core"')
  })

  it('缺参数 / 非法仓库名都报错', () => {
    expect(() => render(':::github\n:::')).toThrow(/缺少仓库名/)
    expect(() => render(':::github not-a-repo\n:::')).toThrow(/无法识别仓库/)
  })

  it('产出**不含** `<p>`（`<a>` 里放 `<p>` 会被浏览器拆卡）', () => {
    const html = render(':::github vuejs/core\n:::')
    // 只在 `<a>` 内部检查：外层容器允许有段落
    const anchorInner = /<a class="embed__link"[\s\S]*?<\/a>/.exec(html)?.[0] ?? ''
    expect(anchorInner).not.toContain('<p')
    expect(anchorInner).not.toContain('<div')
  })
})

describe(':::link', () => {
  it('无标题时用域名兜底（不会出现空盒子等网络）', () => {
    const html = render(':::link https://example.com/page\n:::')
    expect(html).toContain('data-embed="link"')
    expect(html).toContain('example.com')
    expect(html).toContain('href="https://example.com/page"')
  })

  it('自定义标题', () => {
    const html = render(':::link https://example.com 我的标题\n:::')
    expect(html).toContain('我的标题')
    expect(html).toContain('example.com')
  })

  it('非 http(s) 协议报错', () => {
    expect(() => render(':::link ftp://example.com\n:::')).toThrow(/只接受 http/)
    expect(() => render(':::link not-a-url\n:::')).toThrow(/不是合法 URL/)
  })
})

describe(':::figure（有正文）', () => {
  it('图注渲染在图片之后', () => {
    const html = render(':::figure caption="首页截图"\n![首页](/a.png)\n:::')
    expect(html).toContain('embed--figure')
    expect(html).toContain('首页截图')
    // 图注必须在 <img> 之后
    expect(html.indexOf('figcaption')).toBeGreaterThan(html.indexOf('<img'))
  })

  it('内部 Markdown 正常解析（容器里放原生语法）', () => {
    const html = render(':::figure caption="说明"\n![图](/a.png)\n:::')
    expect(html).toContain('<img src="/a.png" alt="图">')
  })

  it('不认识的参数报错', () => {
    expect(() => render(':::figure title="x"\n![/a.png](/a.png)\n:::')).toThrow(/不认识参数/)
  })
})

describe(':::quote（有正文）', () => {
  it('用 blockquote 承载正文，出处单独一行', () => {
    const html = render(':::quote 《C 程序设计语言》\n第一个示例。\n:::')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('<p>第一个示例。</p>')
    expect(html).toContain('《C 程序设计语言》')
  })

  it('多段落与行内语法都能用', () => {
    const html = render(':::quote 出处\n第一段 ==高亮==\n\n第二段\n:::')
    expect(html).toContain('<mark>高亮</mark>')
    expect(html).toContain('<p>第二段</p>')
  })
})

describe('围栏与嵌套', () => {
  it('指令可以嵌套', () => {
    const html = render(':::quote 出处\n:::github vuejs/core\n:::\n:::')
    expect(html).toContain('embed--quote')
    expect(html).toContain('embed--github')
  })

  it('代码块里的 ::: 是内容，不是围栏', () => {
    const html = render('```md\n:::github vuejs/core\n:::\n```')
    expect(html).toContain('language-md')
    expect(html).not.toContain('embed--github')
  })

  it('未闭合报错并指到行号', () => {
    expect(() => render(':::github vuejs/core\n\n后续正文')).toThrow(/没有闭合/)
  })

  it('闭合并排两个指令互不影响', () => {
    const html = render(':::github a/b\n:::\n\n:::github c/d\n:::')
    expect((html.match(/embed--github/g) ?? []).length).toBe(2)
  })
})

/**
 * VitePress 内置容器（`::: tip` 等）与本站指令**共用 `:::` 围栏**，这是
 * 一个真实的结构性冲突：
 *
 * - 内置容器由 VitePress 自己的插件处理，它把遇到的**第一个** `:::` 当成闭合行；
 * - 于是容器内的指令永远等不到属于自己的收尾行。
 *
 * 我们的指令规则挂在 VitePress 的容器之后（`markdown.config` 是最后一道钩子），
 * 所以无法在指令层修掉它。能做的是**把话说清楚**：报错必须点明
 * "你在内置容器里"以及"怎么改"，否则作者会一直盯着"明明写了 :::"。
 *
 * 注意：这个用例用裸 markdown-it 复现不出完整链路（这里没有 VitePress 的容器插件），
 * 所以只断言"检测逻辑在找不到内置容器时不乱报"这一半。
 * 真正的端到端验证在 `pnpm build` 下做过（见 DEVELOPING.md 的已知限制）。
 */
describe('与内置容器的冲突提示', () => {
  it('不在容器里时，报错只提"没有闭合"（不误报容器问题）', () => {
    expect(() => render(':::github vuejs/core\n\n后续正文')).not.toThrow(/内置容器/)
  })

  /*
   * 长围栏是官方推荐的绕过办法：外层容器用更多冒号，内层指令保持 3 个。
   *
   * 这里测的是**指令侧**对长围栏的处理（`::::github` / `::::` 也能开合），
   * 因为那部分完全在我们的规则里。真正"外层容器用 `::::`"的验证需要
   * VitePress 的容器插件，只在 `pnpm build` 下做过（见 DEVELOPING.md）。
   */
  it('指令支持比 3 个更长的围栏', () => {
    const html = render('::::github vuejs/core\n::::')
    expect(html).toContain('data-target="vuejs/core"')
  })

  /*
   * 收尾围栏长度**不要求**与开标签一致（任意 ≥3 个冒号都算收尾）。
   *
   * 这是刻意的宽松：作者把 `::::github` 写成 `:::` 收尾时，意图是明确的，
   * 没有理由报错。代价是没法用围栏长度表达嵌套层次——嵌套靠的是
   * 「先遇到的开标签等它的收尾」这个栈式配对（见 `findClosingLine`），
   * 而不是靠冒号数量。
   */
  it('收尾围栏可以比开标签短（宽松配对）', () => {
    const html = render('::::github vuejs/core\n:::')
    expect(html).toContain('data-target="vuejs/core"')
  })
})

describe('shared/github', () => {
  it('parseGitHubRepo 忽略非仓库路径', () => {
    expect(parseGitHubRepo('https://github.com/vuejs/core')).toEqual({
      owner: 'vuejs',
      repo: 'core',
    })
    expect(parseGitHubRepo('https://github.com/vuejs/core/issues')).toEqual({
      owner: 'vuejs',
      repo: 'core',
    })
    // 单段是个人主页
    expect(parseGitHubRepo('https://github.com/vuejs')).toBeNull()
    // 保留页不是仓库
    expect(parseGitHubRepo('https://github.com/features/actions')).toBeNull()
    // 别的站
    expect(parseGitHubRepo('https://gitlab.com/a/b')).toBeNull()
  })

  it('normalizeRepoSpec 接受短名与完整链接', () => {
    expect(normalizeRepoSpec('vuejs/core')).toBe('vuejs/core')
    expect(normalizeRepoSpec('VueJS/Core')).toBe('VueJS/Core')
    expect(normalizeRepoSpec('https://github.com/vuejs/core')).toBe('vuejs/core')
    expect(normalizeRepoSpec('https://github.com/vuejs/core.git')).toBe('vuejs/core')
    expect(normalizeRepoSpec('<https://github.com/vuejs/core/>')).toBe('vuejs/core')
    expect(normalizeRepoSpec('not a repo')).toBeNull()
    expect(normalizeRepoSpec('a/b/c')).toBeNull()
  })
})
