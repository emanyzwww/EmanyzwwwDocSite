import MarkdownIt from 'markdown-it'
import { describe, expect, it } from 'vitest'

import {
  inferLangFromPath,
  injectCodeHeader,
  installCodeBlocks,
  isInsideCodeGroup,
  parseCodeFile,
} from '../.vitepress/support/markdown/code-blocks'

/**
 * 代码块的构建期增强。
 *
 * 这些用例刻意**不 import `vitepress`**（与其它测试一样的约定：只测纯逻辑，
 * 构建期模块不进 vitest）。VitePress 的 fence 包装器输出是**固定的**，
 * 所以下面用一段等价的字符串当契约，真实管线由 `pnpm build` 兜底。
 */

/** VitePress `preWrapperPlugin` 的输出（顺序固定，是复制按钮的隐式契约）。 */
function staleWrapper(lang = 'ts'): string {
  return (
    `<div class="language-${lang} vp-adaptive-theme">` +
    '<button title="Copy code" class="copy"></button>' +
    `<span class="lang">${lang}</span>` +
    '<pre class="shiki shiki-themes jade-light jade-dark vp-code" tabindex="0" v-pre="">' +
    '<code><span class="line"><span style="--shiki-light:#0F766E">const</span></span></code>' +
    '</pre>\n</div>'
  )
}

describe('parseCodeFile', () => {
  it('取出语言后面的 [路径]', () => {
    expect(parseCodeFile('ts [src/app.ts]')).toBe('src/app.ts')
    expect(parseCodeFile('  [docs/guide.md]')).toBe('docs/guide.md')
  })

  it('允许 Windows 路径与中文文件名', () => {
    expect(parseCodeFile('ts [src\\pages\\index.ts]')).toBe('src\\pages\\index.ts')
    expect(parseCodeFile('md [说明文档.md]')).toBe('说明文档.md')
  })

  it('没写路径时返回 null', () => {
    expect(parseCodeFile('ts')).toBe(null)
    expect(parseCodeFile('')).toBe(null)
    expect(parseCodeFile('ts {1,3}')).toBe(null)
    expect(parseCodeFile('ts [   ]')).toBe(null)
  })
})

describe('inferLangFromPath', () => {
  it('常见扩展名映射到 Shiki 语言 id', () => {
    expect(inferLangFromPath('src/app.ts')).toBe('ts')
    expect(inferLangFromPath('a/b/c.min.js')).toBe('js')
    expect(inferLangFromPath('README.md')).toBe('md')
    expect(inferLangFromPath('pages/index.vue')).toBe('vue')
    expect(inferLangFromPath('deploy.sh')).toBe('bash')
    expect(inferLangFromPath('styles/app.scss')).toBe('scss')
  })

  it('只看最后一段扩展名，大小写不敏感', () => {
    expect(inferLangFromPath('src/dir.ts/README')).toBe(null)
    expect(inferLangFromPath('Script.PY')).toBe('python')
  })

  it('没有扩展名 / 不认识的扩展名返回 null', () => {
    expect(inferLangFromPath('Dockerfile')).toBe(null)
    expect(inferLangFromPath('.gitignore')).toBe(null)
    expect(inferLangFromPath('photo.png')).toBe(null)
  })
})

describe('injectCodeHeader', () => {
  it('有路径：加 code-block--file 与 data-file，label 在 button 之前', () => {
    const html = injectCodeHeader(staleWrapper(), 'src/app.ts')

    expect(html).toContain('class="code-block code-block--file language-ts vp-adaptive-theme"')
    expect(html).toContain('<span class="code-block__label" data-file="src/app.ts" title="src/app.ts">src/app.ts</span>')

    // VitePress 的复制逻辑依赖 button.nextElementSibling.nextElementSibling 是 <pre>
    const labelAt = html.indexOf('code-block__label')
    const buttonAt = html.indexOf('<button')
    const langAt = html.indexOf('<span class="lang">')
    const preAt = html.indexOf('<pre')
    expect(labelAt).toBeGreaterThan(-1)
    expect(labelAt).toBeLessThan(buttonAt)
    expect(buttonAt).toBeLessThan(langAt)
    expect(langAt).toBeLessThan(preAt)
  })

  it('没路径：label 显示语言名，不加 data-file 与 file 修饰类', () => {
    const html = injectCodeHeader(staleWrapper('python'), null)

    expect(html).toContain('class="code-block language-python vp-adaptive-theme"')
    expect(html).toContain('<span class="code-block__label">python</span>')
    expect(html).not.toContain('code-block--file')
    expect(html).not.toContain('data-file')
  })

  it('路径里的 & < > " 会被转义（属性与文本都安全）', () => {
    const html = injectCodeHeader(staleWrapper(), 'a&b/<x>"y".ts')

    expect(html).toContain('data-file="a&amp;b/&lt;x&gt;&quot;y&quot;.ts"')
    expect(html).not.toContain('<x>')
  })

  it('没写语言的围栏（class="language- "）也有头部，label 兜底为 text', () => {
    const html = injectCodeHeader(
      '<div class="language- vp-adaptive-theme"><button title="Copy code" class="copy"></button><span class="lang"></span><pre class="shiki"><code>x</code></pre>\n</div>',
      null,
    )

    expect(html).toContain('class="code-block language- vp-adaptive-theme"')
    expect(html).toContain('<span class="code-block__label">text</span>')
  })

  it('不是 VitePress 包装的 HTML（裸 markdown-it）原样返回', () => {
    const raw = '<pre><code class="language-ts">const a = 1</code></pre>'
    expect(injectCodeHeader(raw, 'src/app.ts')).toBe(raw)
  })
})

describe('isInsideCodeGroup', () => {
  const open = { type: 'container_code-group_open', info: '' }
  const close = { type: 'container_code-group_close', info: '' }
  const fence = { type: 'fence', info: 'ts [a.ts]' }

  it('分组内的代码块', () => {
    expect(isInsideCodeGroup([open, fence], 1)).toBe(true)
    expect(isInsideCodeGroup([fence, open, fence], 2)).toBe(true)
  })

  it('分组外 / 已闭合的不算', () => {
    expect(isInsideCodeGroup([fence], 0)).toBe(false)
    expect(isInsideCodeGroup([open, fence, close, fence], 3)).toBe(false)
  })

  it('嵌套分组也能正确判断', () => {
    expect(isInsideCodeGroup([open, open, fence], 2)).toBe(true)
    expect(isInsideCodeGroup([open, open, fence, close, fence], 4)).toBe(true)
    // 两层都闭合了才算外面
    expect(isInsideCodeGroup([open, open, close, fence], 3)).toBe(true)
    expect(isInsideCodeGroup([open, open, close, close, fence], 4)).toBe(false)
  })
})

/* ------------------------------------------------------------------ *
 * 装配：用 markdown-it + 一个模拟 VitePress 的 fence 规则
 * ------------------------------------------------------------------ */

/** 一个模仿 VitePress 包装器的假 fence 规则（只关心语言名）。 */
function fakeFence(tokens: { info: string }[], idx: number): string {
  const info = tokens[idx]?.info.trim() ?? ''
  const lang = info.replace(/\[[^\]]*\]/g, '').trim().split(/\s+/)[0] || 'txt'
  return `<div class="language-${lang} vp-adaptive-theme"><button title="Copy code" class="copy"></button><span class="lang">${lang}</span><pre class="shiki"><code>const a = 1</code></pre>\n</div>`
}

function createRenderer(fence = fakeFence): MarkdownIt {
  const md = new MarkdownIt({ html: true })
  const rule = (tokens: { info: string }[], idx: number) => fence(tokens, idx)
  md.renderer.rules.fence = rule as never
  installCodeBlocks(md)
  return md
}

const code = '```ts [src/app.ts]\nconst a = 1\n```'

describe('installCodeBlocks', () => {
  it('给普通围栏加上头部标记', () => {
    const html = createRenderer().render(code)

    expect(html).toContain('code-block code-block--file')
    expect(html).toContain('data-file="src/app.ts"')
  })

  it('只写路径、不写语言：先按扩展名补语言再交给高亮', () => {
    const html = createRenderer().render('``` [src/pages/index.ts]\nconst a = 1\n```')

    expect(html).toContain('language-ts')
    expect(html).toContain('data-file="src/pages/index.ts"')
  })

  it('缺语言又推不出语言时保持原样（不高亮，也不报错）', () => {
    const html = createRenderer().render('``` [Dockerfile]\nFROM node\n```')

    expect(html).toContain('language-txt')
    expect(html).toContain('data-file="Dockerfile"')
  })

  it('代码分组内的围栏不注入头部（tab 条已经是头部）', () => {
    const md = createRenderer()
    const rule = md.renderer.rules.fence as unknown as (
      tokens: { type: string; info: string }[],
      idx: number,
    ) => string

    const tokens = [{ type: 'container_code-group_open', info: '' }, { type: 'fence', info: 'ts [a.ts]' }]
    const html = rule(tokens, 1)

    expect(html).not.toContain('code-block')
    expect(html).not.toContain('data-file')
  })

  it('裸 markdown-it 输出（非页面 Markdown）不受影响', () => {
    const md = createRenderer(() => '<pre><code>const a = 1</code></pre>')
    expect(md.render(code).trim()).toBe('<pre><code>const a = 1</code></pre>')
  })
})
