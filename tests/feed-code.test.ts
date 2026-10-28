import { describe, expect, it } from 'vitest'

import { sanitizeFeedCode } from '../.vitepress/support/feed-code'

/**
 * RSS 代码块清洗（`support/feed-code.ts`）。
 *
 * fixture 不是手写的「理想 HTML」，而是**真实产物**：VitePress 1.6.4 + 本站
 * Markdown 管线（`code-theme.ts` 双主题、`code-blocks.ts` 头部控件区）渲染出来的
 * 结构，属性顺序、`vp-adaptive-theme`、`data-file` 都与实际输出一致。
 *
 * 两种输入来源都要覆盖：
 *
 * - **构建产物**（Vue 序列化后，RSS 真正拿到的那份）：`v-pre` 已被 Vue 消费掉，
 *   元素之间也没有纯空白文本节点；
 * - **markdown-it 原始输出**：还带 `v-pre=""` 与元素间换行。以后若有人想
 *   在渲染期复用这个清洗函数，也必须能处理。
 */

/* ------------------------------------------------------------------ *
 * 一、fixture
 * ------------------------------------------------------------------ */

/** 构建产物里的普通代码块：没写 `[路径]`，头部只有语言名。 */
const PLAIN = [
  '<div class="code-block language-js vp-adaptive-theme">',
  '<span class="code-block__label">js</span>',
  '<button title="Copy code" class="copy"></button>',
  '<span class="lang">js</span>',
  '<pre class="shiki shiki-themes jade-light jade-dark vp-code" tabindex="0">',
  '<code><span class="line">',
  '<span style="--shiki-light:#0F766E;--shiki-dark:#4ACDB4">let</span>',
  '<span style="--shiki-light:#161C1A;--shiki-dark:#DFE5E2"> b = 2</span>',
  '</span></code></pre>',
  '</div>',
].join('')

/** 构建产物里带 `[路径]` 的代码块：标签多出 `data-file` 与 `title`。 */
const WITH_FILE = [
  '<div class="code-block code-block--file language-ts vp-adaptive-theme">',
  '<span class="code-block__label" data-file="src/app.ts" title="src/app.ts">src/app.ts</span>',
  '<button title="Copy code" class="copy"></button>',
  '<span class="lang">ts</span>',
  '<pre class="shiki shiki-themes jade-light jade-dark vp-code" tabindex="0">',
  '<code><span class="line">',
  '<span style="--shiki-light:#0F766E;--shiki-dark:#4ACDB4">const</span>',
  '<span style="--shiki-light:#8A3F63;--shiki-dark:#E0A4C4"> a</span>',
  '<span style="--shiki-light:#0F766E;--shiki-dark:#4ACDB4"> =</span>',
  '<span style="--shiki-light:#8A3F63;--shiki-dark:#E0A4C4"> 1</span>',
  '<span style="--shiki-light:#5C6663;--shiki-dark:#7D8783"> // hi</span>',
  '</span></code></pre>',
  '</div>',
].join('')

/** markdown-it 原始输出：多一个 `v-pre=""`，且 `</pre>` 与包装层之间有一个换行。 */
const WITH_FILE_RAW = WITH_FILE.replace(
  ' vp-code" tabindex="0">',
  ' vp-code" tabindex="0" v-pre="">',
).replace('</pre></div>', '</pre>\n</div>')

/** 代码分组（构建产物）：两个面板，第二个带 `active`。 */
const GROUP_ACTIVE_SECOND = [
  '<div class="vp-code-group vp-adaptive-theme">',
  '<div class="tabs">',
  '<input type="radio" name="group-x" id="tab-a" checked>',
  '<label data-title="a.ts" for="tab-a">a.ts</label>',
  '<input type="radio" name="group-x" id="tab-b">',
  '<label data-title="b.js" for="tab-b">b.js</label>',
  '</div>',
  '<div class="blocks">',
  '<div class="language-ts vp-adaptive-theme">',
  '<button title="Copy code" class="copy"></button>',
  '<span class="lang">ts</span>',
  '<pre class="shiki shiki-themes jade-light jade-dark vp-code" tabindex="0">',
  '<code><span class="line">',
  '<span style="--shiki-light:#0F766E;--shiki-dark:#4ACDB4">const</span>',
  '<span style="--shiki-light:#8A3F63;--shiki-dark:#E0A4C4"> a</span>',
  '</span></code></pre>',
  '</div>',
  '<div class="language-js vp-adaptive-theme active">',
  '<button title="Copy code" class="copy"></button>',
  '<span class="lang">js</span>',
  '<pre class="shiki shiki-themes jade-light jade-dark vp-code" tabindex="0">',
  '<code><span class="line">',
  '<span style="--shiki-light:#0F766E;--shiki-dark:#4ACDB4">let</span>',
  '<span style="--shiki-light:#161C1A;--shiki-dark:#DFE5E2"> b</span>',
  '</span></code></pre>',
  '</div>',
  '</div>',
  '</div>',
].join('')

/** 代码分组（markdown-it 原始输出）：`active` 在第一块，面板之间有换行。 */
const GROUP_ACTIVE_FIRST = [
  '<div class="vp-code-group vp-adaptive-theme">',
  '<div class="tabs">',
  '<input type="radio" name="group-x" id="tab-a" checked>',
  '<label data-title="a.ts" for="tab-a">a.ts</label>',
  '<input type="radio" name="group-x" id="tab-b">',
  '<label data-title="b.js" for="tab-b">b.js</label>',
  '</div>',
  '<div class="blocks">\n',
  '<div class="language-ts vp-adaptive-theme active">',
  '<button title="Copy code" class="copy"></button>',
  '<span class="lang">ts</span>',
  '<pre class="shiki shiki-themes jade-light jade-dark vp-code" tabindex="0" v-pre="">',
  '<code><span class="line">',
  '<span style="--shiki-light:#0F766E;--shiki-dark:#4ACDB4">const</span>',
  '<span style="--shiki-light:#8A3F63;--shiki-dark:#E0A4C4"> a</span>',
  '</span></code></pre>\n',
  '</div>',
  '<div class="language-js vp-adaptive-theme">',
  '<button title="Copy code" class="copy"></button>',
  '<span class="lang">js</span>',
  '<pre class="shiki shiki-themes jade-light jade-dark vp-code" tabindex="0" v-pre="">',
  '<code><span class="line">',
  '<span style="--shiki-light:#0F766E;--shiki-dark:#4ACDB4">let</span>',
  '<span style="--shiki-light:#161C1A;--shiki-dark:#DFE5E2"> b</span>',
  '</span></code></pre>\n',
  '</div>',
  '</div></div>\n',
].join('')

/* ------------------------------------------------------------------ *
 * 二、断言工具
 * ------------------------------------------------------------------ */

/**
 * 网页专用的零件一个都不许漏进 feed。
 *
 * 特别注意 `--shiki-` 与 `color:`：前者是网页明暗切换用的自定义属性，
 * 后者在双主题下根本不该出现（`defaultColor: false`）。
 */
function expectFeedSafe(html: string): void {
  expect(html).not.toMatch(/code-block|class="lang"|class="copy"|vp-code-group/)
  expect(html).not.toMatch(/class="tabs"|class="blocks"|language-/)
  expect(html).not.toMatch(/tabindex|v-pre|--shiki-|class="shiki/)
}

/* ------------------------------------------------------------------ *
 * 三、用例
 * ------------------------------------------------------------------ */

describe('没有代码块时恒等', () => {
  const prose = [
    '<h2 id="标题">标题 <a class="header-anchor" href="#标题">#</a></h2>',
    '<p>正文里有 <code>inline</code> 与 <a href="/zh-cn/about/">链接</a>。</p>',
    '<figure><img src="/assets/media/x-672.webp" alt="" width="672"><figcaption>图注</figcaption></figure>',
    '<table><thead><tr><th>列</th></tr></thead><tbody><tr><td>值</td></tr></tbody></table>',
  ].join('\n')

  it('正文、行内代码、图注与表格逐字节不变', () => {
    expect(sanitizeFeedCode(prose)).toBe(prose)
  })

  it('空字符串仍然是空字符串', () => {
    expect(sanitizeFeedCode('')).toBe('')
  })
})

describe('普通代码块', () => {
  it('删掉复制按钮、语言标识与包装层，pre 只剩标签名', () => {
    const out = sanitizeFeedCode(PLAIN)

    expect(out).toBe(
      '<pre><code><span class="line"><span>let</span><span> b = 2</span></span></code></pre>',
    )
    expectFeedSafe(out)
  })

  it('有 [路径] 时保留一行小字路径，且只保留这一处', () => {
    const out = sanitizeFeedCode(WITH_FILE)

    expect(out.startsWith('<p><small>src/app.ts</small></p><pre>')).toBe(true)
    expect(out.match(/<p><small>/g)).toHaveLength(1)
    expect(out).not.toContain('data-file')
    expectFeedSafe(out)
  })

  it('markdown-it 原始输出（带 v-pre 与换行）同样能清', () => {
    const out = sanitizeFeedCode(WITH_FILE_RAW)

    expect(out).toBe(
      '<p><small>src/app.ts</small></p>' +
        '<pre><code><span class="line"><span>const</span><span> a</span><span> =</span>' +
        '<span> 1</span><span> // hi</span></span></code></pre>\n',
    )
    expectFeedSafe(out)
  })

  it('代码内容里的实体原样保留，不做二次转义', () => {
    // 构建产物里 Vue 会把 shiki 的数字实体重新序列化成命名实体；
    // 两种写法都必须原样穿过清洗器（`&lt;` 就是代码里的字面量 `<`）。
    const block = [
      '<div class="code-block language-html vp-adaptive-theme">',
      '<span class="code-block__label">html</span>',
      '<button title="Copy code" class="copy"></button>',
      '<span class="lang">html</span>',
      '<pre class="shiki shiki-themes jade-light jade-dark vp-code" tabindex="0">',
      '<code><span class="line">',
      '<span style="--shiki-light:#0F766E;--shiki-dark:#4ACDB4">&#x3C;div&#x3E;</span>',
      '<span style="--shiki-light:#161C1A;--shiki-dark:#DFE5E2"> &amp; &lt;b&gt; &quot;x&quot;</span>',
      '</span></code></pre>',
      '</div>',
    ].join('')

    const out = sanitizeFeedCode(block)

    expect(out).toContain('&#x3C;div&#x3E;')
    expect(out).toContain('&amp; &lt;b&gt; &quot;x&quot;')
  })

  it('没有语言名的块（包装层只有 language-）也能拆掉', () => {
    // 裸围栏（``` 后什么都不写）在页面上的包装层是 `class="language- vp-adaptive-theme"`，
    // 头部控件区不会注入（没有语言名可显示），但复制按钮与包装层仍然要清掉
    const block = [
      '<div class="language- vp-adaptive-theme">',
      '<button title="Copy code" class="copy"></button>',
      '<span class="lang"></span>',
      '<pre class="shiki shiki-themes jade-light jade-dark vp-code" tabindex="0">',
      '<code><span class="line"><span>纯文本</span></span></code></pre>',
      '</div>',
    ].join('')

    const out = sanitizeFeedCode(block)

    expect(out).toBe('<pre><code><span class="line"><span>纯文本</span></span></code></pre>')
    expectFeedSafe(out)
  })

  it('路径里的转义直接复用，不再二次处理', () => {
    const block = WITH_FILE.replace('src/app.ts', 'src/a&amp;b.ts')
    const out = sanitizeFeedCode(block)

    expect(out).toContain('<p><small>src/a&amp;b.ts</small></p>')
  })
})

describe('::: code-group', () => {
  it('删掉 tabs 与其余面板，只留 active 那块', () => {
    const out = sanitizeFeedCode(GROUP_ACTIVE_SECOND)

    expect(out).toBe(
      '<pre><code><span class="line"><span>let</span><span> b</span></span></code></pre>',
    )
    expectFeedSafe(out)
    expect(out).not.toContain('const')
  })

  it('markdown-it 原始输出里的换行与 active 位置也正确', () => {
    const out = sanitizeFeedCode(GROUP_ACTIVE_FIRST)

    expect(out.trim()).toBe(
      '<pre><code><span class="line"><span>const</span><span> a</span></span></code></pre>',
    )
    expect(out).not.toContain('let')
    expectFeedSafe(out)
  })

  it('没有 active（所有围栏都没写标题）时兜底保留第一块', () => {
    const out = sanitizeFeedCode(GROUP_ACTIVE_FIRST.replace(' active', ''))

    expect(out).toContain('const')
    expect(out).not.toMatch(/tabindex|class="tabs"/)
  })
})

describe('互不干扰', () => {
  it('路径行只对写了 [路径] 的块出现', () => {
    const html = `${WITH_FILE}${PLAIN}`
    const out = sanitizeFeedCode(html)

    expect(out.match(/<p><small>/g)).toHaveLength(1)
    expect(out).toContain('src/app.ts')
    // 没有路径的块紧跟前一块的 pre，中间不能凭空多出一行路径
    expect(out).toContain('</pre><pre><code><span class="line"><span>let</span>')
  })

  it('代码块嵌在 ::: tip 里时，外层容器与表格保持完整', () => {
    const html = [
      '<div class="tip custom-block"><p class="custom-block-title">TIP</p>',
      PLAIN,
      '</div>',
      '<table><tbody><tr><td>代码块之后的表格</td></tr></tbody></table>',
    ].join('')

    const out = sanitizeFeedCode(html)

    expect(out).toBe(
      '<div class="tip custom-block"><p class="custom-block-title">TIP</p>' +
        '<pre><code><span class="line"><span>let</span><span> b = 2</span></span></code></pre>' +
        '</div><table><tbody><tr><td>代码块之后的表格</td></tr></tbody></table>',
    )
  })

  it('幂等：清洗过的 HTML 再洗一遍不变', () => {
    const html = `${WITH_FILE}${GROUP_ACTIVE_SECOND}<p>段落</p>${PLAIN}`
    const once = sanitizeFeedCode(html)

    expect(sanitizeFeedCode(once)).toBe(once)
  })
})
