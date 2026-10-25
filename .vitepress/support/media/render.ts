/**
 * Markdown 侧：把图片渲染升级成 `<figure>` + 多档 `srcset` + 可点击放大。
 *
 * ## 为什么必须做「块级」改写，不能只换 inline 渲染规则
 *
 * HTML 规范里 `<figure>` 属于「会关闭 `<p>`」的元素。若输出
 * `<p><figure>…</figure></p>`，**浏览器解析时会重排成**
 * `<p></p><figure>…</figure>`，而 Vue 的 vnode 树是按原字符串建的
 * → hydration mismatch（首屏闪一下、严重时整块 DOM 重建）。
 *
 * 所以在 `core` 阶段把「段落里恰好只有一张图」的
 * `paragraph_open / inline / paragraph_close` 整体改写成 `figure_open / figure_close`。
 *
 * ## 顺序约束（改了会静默失效）
 *
 * 本规则必须挂在 `inline` 之后 —— VitePress 内联的 `markdown-it-attrs`
 * 是 `curly_attributes`（`before('linkify', …)`），挂在它之前就读不到
 * `{width=1200}` 已经写进 token 的属性。
 *
 * ## 只提升「独占一段的图」
 *
 * 下面这些**故意不提升**（都有测试覆盖）：
 * - `文字 ![a](./x.png) 后面还有` —— 行内图，提升会切断句子
 * - `[![a](./x.png)](https://…)` —— 作者自带链接，尊重作者意图
 * - `![a](https://…)` —— 外链，不归我们管
 * - `![a](./x.png){data-plain}` —— 作者显式要求不放大（拍板项 6 的开关）
 */

import { existsSync } from 'node:fs'

import { markupOf, resolveMedia, resolveSource } from './registry'

/* ------------------------------------------------------------------ *
 * 最小 token 形状（与 support/markdown-plugins.ts 同风格）
 * ------------------------------------------------------------------ */

interface TokenLike {
  type: string
  tag: string
  nesting: -1 | 0 | 1
  content: string
  markup: string
  meta: Record<string, unknown> | null
  attrs: [string, string][] | null
  children: TokenLike[] | null
  attrGet(name: string): string | null
  attrJoin(name: string, value: string): void
}

interface CoreState {
  tokens: TokenLike[]
  env: Record<string, unknown>
}

type RenderRule = (
  tokens: TokenLike[],
  idx: number,
  options: unknown,
  env: unknown,
  self: RendererLike,
) => string

interface RendererLike {
  rules: Record<string, RenderRule | undefined>
  renderToken(tokens: TokenLike[], idx: number, options: unknown): string
  /**
   * 把图片 token 的 `children`（alt 文本）渲染成纯文本。
   *
   * **必须用它取 alt，不能用 `token.attrGet('alt')`**：markdown-it 的默认
   * image 规则正是这么做的（`token.attrs[altIndex][1] = renderInlineAsText(children)`），
   * 而 `alt` 属性在 token 上是**空串占位**——直接读会得到 `alt=""`，
   * 等于把作者的替代文本全部丢掉（对读屏用户是硬伤）。
   */
  renderInlineAsText(tokens: TokenLike[] | null, options: unknown, env: unknown): string
}

interface MarkdownItLike {
  core: {
    ruler: {
      after(after: string, name: string, rule: (state: CoreState) => void): void
    }
  }
  renderer: RendererLike
}

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

/** HTML 属性值转义。alt / title 来自作者输入，必须转。 */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 段落里「只有一张图」时返回那张图，否则 `null`。 */
function soleImageOf(inline: TokenLike): TokenLike | null {
  const children = inline.children ?? []
  // 空白文本节点是排版噪声（`![a](x.png)` 后面常跟一个由换行产生的空格）
  const meaningful = children.filter((child) => !(child.type === 'text' && !child.content.trim()))
  if (meaningful.length !== 1) return null

  const only = meaningful[0]
  return only.type === 'image' ? only : null
}

/* ------------------------------------------------------------------ *
 * 渲染
 * ------------------------------------------------------------------ */

/** 我们挂在图片 token 上的 meta。 */
interface ImageMeta {
  /** 这张图在 `<figure>` 内部。 */
  figure?: boolean
}

/**
 * 渲染一张图。
 *
 * 三种结果：
 * - 多档位图 + `<figure>` 内 → `<a href=原图><img srcset=…></a>`（可点开放大）
 * - 多档位图但不在 figure 内 → 裸 `<img srcset=…>`
 * - 外链 / SVG / 找不到文件 → 交回上游规则，行为与升级前**完全一致**
 */
function renderImage(token: TokenLike, env: unknown, self: RendererLike, md: MarkdownItLike): string {
  const src = token.attrGet('src') ?? ''
  /*
   * alt 必须从 children 渲染，不能读 attrs。
   *
   * markdown-it 的 image token 上 `alt` 属性是**空串占位**，真正的替代文本在
   * `children` 里（见默认 image 规则的 `renderInlineAsText`）。直接读属性会
   * 输出 `alt=""`，把作者的替代文本全丢掉 —— 对读屏用户等于图不存在。
   */
  const alt = token.children ? self.renderInlineAsText(token.children, {}, env) : ''
  const title = token.attrGet('title')
  const meta = (token.meta ?? {}) as ImageMeta

  const mdPath = (env as { path?: string } | undefined)?.path
  const sourcePath = mdPath ? resolveSource(mdPath, src) : null

  // 外链 / data URI / 无源路径：不归我们管
  if (!sourcePath || !existsSync(sourcePath)) return fallback(token, env, self, md)

  /*
   * 文件存在就自己处理，**任何错误都往上抛**。
   *
   * 这条边界很关键：文件不存在时交给上游（VitePress → Vite），
   * 它会给出含「哪个文件 import 了它」的 rollup 报错，比我们的更具体；
   * 而文件存在却处理不了（bmp、超大、读不出尺寸）必须由我们报错，
   * 否则会被 Vite 当成普通资产静默拷贝过去，用户看到一张不转码的图。
   */
  const entry = resolveMedia(sourcePath)
  const markup = markupOf(entry)

  const zoomable = markup.srcset !== ''

  // 作者用 attrs 显式写了 width/height 就尊重作者（VitePress 的 `{width=100}`）
  const explicitWidth = Number(token.attrGet('width'))
  const width = explicitWidth > 0 ? explicitWidth : markup.width
  const height =
    Number(token.attrGet('height')) > 0
      ? Number(token.attrGet('height'))
      : Math.round((width / markup.width) * markup.height)

  const attrs = [
    `src="${escapeAttr(markup.src)}"`,
    markup.srcset ? `srcset="${escapeAttr(markup.srcset)}"` : '',
    markup.sizes ? `sizes="${escapeAttr(markup.sizes)}"` : '',
    `alt="${escapeAttr(alt)}"`,
    Number.isFinite(width) && width > 0 ? `width="${width}"` : '',
    Number.isFinite(height) && height > 0 ? `height="${height}"` : '',
    title ? `title="${escapeAttr(title)}"` : '',
    'loading="lazy"',
    'decoding="async"',
    /*
     * LQIP 占位：构建期产出的极小模糊图（base64 data URI）。
     * CSS 侧把它铺在图片的预留区里当加载前的色彩占位，
     * `data-loaded` 打上后淡出（见 content.css 的 prose-media 骨架一节）。
     */
    markup.lqip ? `data-lqip="${escapeAttr(markup.lqip)}"` : '',
    zoomable ? 'data-zoomable="true"' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const img = `<img ${attrs}>`

  if (!meta.figure) return img
  // 拍板项 6：作者显式关掉放大
  const plain = token.attrGet('data-plain') !== null
  // SVG / 动图没有多档，放大没有额外信息，不做成链接
  if (plain || !zoomable) return img

  /*
   * 图注：用 `title` 优先（`![alt](x.png '标题')` 里的标题是作者显式写给"图注"的），
   * 否则不渲染 —— 把 alt 当图注是错的：alt 是给读屏的无障碍文本，
   * 常常是"一张截图"这种对视觉读者没信息量的话。
   */
  const caption = title ? `<figcaption>${escapeAttr(title)}</figcaption>` : ''

  return (
    `<a class="prose-media__link" href="${escapeAttr(markup.origin)}"` +
    ` data-lightbox="true" data-origin-name="${escapeAttr(markup.originName)}"` +
    ` data-media-key="${escapeAttr(markup.key)}">${img}</a>` +
    caption
  )
}

/**
 * 交回上游规则。
 *
 * 保存的是**安装时**的规则（VitePress 的 `imagePlugin` 包过默认渲染器），
 * 所以外链、`{width=}`、`alt` 从 children 推导这些行为全部保持不变。
 *
 * 用 `WeakMap` 按 md 实例存而不是模块级变量：页面渲染与将来可能出现的
 * 第二个渲染器（编辑器预览）各自持有自己的上游规则，互不覆盖。
 */
const upstreamRules = new WeakMap<object, RenderRule>()

function fallback(token: TokenLike, env: unknown, self: RendererLike, owner: object): string {
  const upstream = upstreamRules.get(owner)
  if (upstream) return upstream([token], 0, {}, env, self)
  return self.renderToken([token], 0, {})
}

/* ------------------------------------------------------------------ *
 * 规则安装
 * ------------------------------------------------------------------ */

/** 把「独占一段的图」提升为 `<figure class="prose-media">`。 */
function installFigureRule(md: MarkdownItLike): void {
  md.core.ruler.after('inline', 'media_figure', (state: CoreState) => {
    const tokens = state.tokens

    for (let index = 0; index < tokens.length; index += 1) {
      if (tokens[index].type !== 'paragraph_open') continue
      if (tokens[index + 1]?.type !== 'inline') continue
      if (tokens[index + 2]?.type !== 'paragraph_close') continue

      const image = soleImageOf(tokens[index + 1])
      if (!image) continue

      image.meta = { ...image.meta, figure: true }

      const open = tokens[index]
      open.type = 'figure_open'
      open.tag = 'figure'
      open.nesting = 1
      open.attrJoin('class', 'prose-media')

      const close = tokens[index + 2]
      close.type = 'figure_close'
      close.tag = 'figure'
      close.nesting = -1

      index += 2
    }
  })
}

/**
 * 安装媒体渲染规则。**必须在 `markdown.config` 里调用**
 * —— 那是 VitePress 留给用户的最后一道钩子，能看到 attrs 已写入的 width/height。
 *
 * 参数类型放宽成 `unknown` 再在内部窄化：`markdown-it` 的类型有三份互不兼容的
 * 声明（CJS / ESM / VitePress 内联），与 `support/markdown-plugins.ts` 顶部
 * 记录的是同一个问题。函数签名收 `unknown` 后，三份都能传进来。
 */
export function mediaMarkdown(md: unknown): void {
  const instance = md as MarkdownItLike
  const upstream = instance.renderer.rules.image
  if (upstream) upstreamRules.set(instance, upstream)

  installFigureRule(instance)
  instance.renderer.rules.image = (tokens, idx, _options, env, self) =>
    renderImage(tokens[idx], env, self, instance)
}
