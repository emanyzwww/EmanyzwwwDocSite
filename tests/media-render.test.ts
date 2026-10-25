import MarkdownIt from 'markdown-it'
import { beforeEach, describe, expect, it } from 'vitest'

import { mediaMarkdown } from '../.vitepress/support/media/render'
import { clearMediaRegistry, resolveMedia, resolveSource } from '../.vitepress/support/media/registry'
import { setMediaRuntime } from '../.vitepress/support/media/runtime'

/**
 * `<figure>` 提升与图片渲染。
 *
 * 这套用例只覆盖**边界判定**（哪些图会被提升、哪些必须放行）与属性输出，
 * 不验证产物字节 —— 那需要 sharp 真编码，属于构建期的事。
 *
 * 用 `tests/fixtures/tiny.png`（400×225，由 sharp 生成）当真实源文件：
 * 尺寸小到不触发多档切分逻辑，但仍会走完整的 `resolveMedia` 路径。
 */

const EXISTING = './fixtures/tiny.png'

/** 一个装了媒体插件的 markdown-it（尽量贴近 VitePress 的配置）。 */
function createMd(): MarkdownIt {
  const md = new MarkdownIt({ html: true, linkify: true })
  mediaMarkdown(md)
  return md
}

/** 渲染时带上 `env.path`（VitePress 就是这么传的）。 */
function render(source: string, path = `${process.cwd()}/tests/media-render.test.ts`): string {
  return createMd().render(source, { path }).trim()
}

beforeEach(() => {
  // 注册表是模块级单例：用例间清空，避免 LQIP 假字节泄漏进下一个用例
  clearMediaRegistry()
  // 只有 publicDir / base 会影响结果，这里给一组固定值
  setMediaRuntime({
    mode: 'dev',
    base: '/',
    srcDir: `${process.cwd()}/docs`,
    publicDir: `${process.cwd()}/public`,
    outDir: `${process.cwd()}/.vitepress/dist`,
  })
})

describe('figure 提升', () => {
  it('独占一段的图被提升为 figure', () => {
    const html = render(`![alt](${EXISTING})`)
    expect(html.startsWith('<figure')).toBe(true)
    expect(html).toContain('</figure>')
    // 绝不能出现 <p><figure>：HTML 解析器会把 p 提前闭合，造成 hydration mismatch
    expect(html).not.toContain('<p><figure')
  })

  it('图与文字同行时不提升（行内图会切断句子）', () => {
    const html = render(`前面有字 ![alt](${EXISTING}) 后面还有字`)
    expect(html).not.toContain('<figure')
    expect(html).toContain('<p>')
    expect(html).toContain('<img')
  })

  it('图后紧跟文字时不提升', () => {
    const html = render(`![alt](${EXISTING}) 后面的字`)
    expect(html).not.toContain('<figure')
  })

  it('作者自带链接时不提升（尊重作者意图）', () => {
    const html = render(`[![alt](${EXISTING})](https://github.com)`)
    expect(html).not.toContain('<figure')
    expect(html).toContain('https://github.com')
  })

  it('一段里有两张图时不提升', () => {
    const html = render(`![a](${EXISTING}) ![b](${EXISTING})`)
    expect(html).not.toContain('<figure')
  })

  it('外链图保留原样，不接管、不加放大链接', () => {
    const html = render('![remote](https://example.com/a.png)')
    /*
     * 外链会被提到 `<figure>` 里（块级语义对外链同样成立，且能吃到统一的
     * 上下间距），但**不会**被包进放大的 `<a>`：我们既不知道它的尺寸，
     * 也不能保证它同源可下载。
     */
    expect(html).toContain('src="https://example.com/a.png"')
    expect(html).not.toContain('data-lightbox')
    expect(html).not.toContain('data-zoomable')
    expect(html).not.toContain('srcset')
  })

  it('找不到的本地图交回上游，不抛错（让 Vite 报更准确的错）', () => {
    expect(() => render('![alt](./definitely-missing.png)')).not.toThrow()
    expect(render('![alt](./definitely-missing.png)')).toContain('./definitely-missing.png')
  })

  it('连续多个独占段落的图各自成 figure', () => {
    const html = render(`![a](${EXISTING})\n\n![b](${EXISTING})`)
    expect(html.match(/<figure/g)).toHaveLength(2)
    expect(html.match(/<\/figure>/g)).toHaveLength(2)
  })
})

describe('渲染属性', () => {
  it('保留 alt（从 children 渲染，不是读空的 attrs 占位）', () => {
    // 回归：早期版本读 token.attrGet('alt')，结果永远输出 alt=""，
    // 等于把作者的替代文本全部丢掉
    const html = render(`![架构总览](${EXISTING})`)
    expect(html).toContain('alt="架构总览"')
    expect(html).not.toContain('alt=""')
  })

  it('alt 里的 HTML 特殊字符被转义', () => {
    const html = render(`![a "quoted" <tag>](${EXISTING})`)
    expect(html).not.toContain('<tag>')
  })

  it('带 title 时输出 figcaption', () => {
    const html = render(`![alt](${EXISTING} '这是图注')`)
    expect(html).toContain('<figcaption>这是图注</figcaption>')
  })

  it('没有 title 时不输出 figcaption（alt 不等于图注）', () => {
    const html = render(`![alt](${EXISTING})`)
    expect(html).not.toContain('<figcaption>')
  })

  it('图片带 loading=lazy 与 decoding=async', () => {
    const html = render(`![alt](${EXISTING})`)
    expect(html).toContain('loading="lazy"')
    expect(html).toContain('decoding="async"')
  })

  it('输出 width / height（防 CLS 的关键）', () => {
    const html = render(`![alt](${EXISTING})`)
    expect(html).toMatch(/width="\d+"/)
    expect(html).toMatch(/height="\d+"/)
  })

  it('多档图带 data-zoomable，放大器据此决定是否接管', () => {
    const html = render(`![alt](${EXISTING})`)
    expect(html).toContain('data-zoomable="true"')
    expect(html).toContain('srcset=')
  })

  it('带 data-lqip 占位（构建期模糊缩略图，data: URI）', () => {
    /*
     * 渲染侧只负责「entry.files 里有 LQIP 字节 → 内联成 data URI」这一步；
     * 真正的字节由 sharp 转码产出（构建期的事，单测不跑）。
     * 这里手工塞一段假字节，验证链接通、转义对、格式前缀正确。
     */
    const sourcePath = resolveSource(`${process.cwd()}/tests/media-render.test.ts`, EXISTING)
    const entry = resolveMedia(sourcePath!)
    const name = entry.lqipFileName?.split('/').pop()
    expect(name).toBeTruthy()
    entry.files.set(name!, Buffer.from('not-real-webp'))

    const html = render(`![alt](${EXISTING})`)
    const match = html.match(/data-lqip="([^"]+)"/)
    expect(match).not.toBeNull()
    expect(match?.[1]).toMatch(/^data:image\/webp;base64,/)
  })

  it('LQIP 字节未就绪时不输出 data-lqip（dev 按需转码前的合法状态）', () => {
    // 不塞字节：resolveMedia 后直接渲染，files 里没有 LQIP
    const html = render(`![alt](${EXISTING})`)
    expect(html).not.toContain('data-lqip')
  })

  it('外链图不带 data-lqip（不归管线管）', () => {
    const html = render('![remote](https://example.com/a.png)')
    expect(html).not.toContain('data-lqip')
  })
})

describe('data-plain（作者关掉放大）', () => {
  it('带 {data-plain} 时不包放大链接', () => {
    /*
     * 裸 markdown-it 没有 attrs 插件，`{data-plain}` 不会被解析成属性，
     * 所以这里手工把属性塞到 token 上 —— 模拟 VitePress 里 attrs 插件
     * 已经消费过的状态（那正是我们的渲染规则真正看到的东西）。
     */
    const md = createMd()
    const tokens = md.parse(`![alt](${EXISTING})`, {})
    const inline = tokens.find((token) => token.type === 'inline')
    const image = inline?.children?.find((child) => child.type === 'image')
    expect(image).toBeDefined()
    image?.attrSet('data-plain', '')

    const html = md.renderer.render(tokens, md.options, { path: `${process.cwd()}/x.md` })
    expect(html).toContain('<figure')
    expect(html).not.toContain('data-lightbox')
  })

  it('没有 data-plain 时正常包放大链接', () => {
    const html = render(`![alt](${EXISTING})`)
    expect(html).toContain('data-lightbox="true"')
    expect(html).toContain('prose-media__link')
  })
})
