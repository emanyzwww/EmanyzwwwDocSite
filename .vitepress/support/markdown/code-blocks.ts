/**
 * 代码块的**构建期**增强：文件路径标签 + 语言兜底 + 头部控件区的 DOM。
 *
 * ## 它解决什么
 *
 * VitePress 输出的代码块结构是「一个深色矩形 + 绝对定位的语言标签 + 悬停才出现的
 * 复制按钮」：
 *
 * ```html
 * <div class="language-ts"><button class="copy"></button><span class="lang">ts</span><pre>…</pre></div>
 * ```
 *
 * 这套结构有两个问题（见 DESIGN.md §10.2）：语言标签浮在代码右上角，长代码行会从
 * 标签底下穿过去；复制按钮默认透明，读者不知道它存在。本站把它改成**常驻的头部
 * 控件区**：左边是文件路径（没写路径时是语言名），右边是语言标识与复制按钮。
 *
 * 本文件的职责只有一件：**在构建期把头部需要的标记写进 HTML**。
 * 视觉、明暗切换、常驻逻辑全部在 `theme/styles/content.css` 里，运行期零 JS。
 *
 * ## 写法
 *
 * ````markdown
 * ```ts [src/pages/index.ts]
 * const a = 1
 * ```
 * ````
 *
 * `[路径]` 是 **VitePress 的既有约定**（`::: code-group` 用它作标签名），
 * 因此不需要再发明一套语法，而且它会被 VitePress 自己的 fence 包装器从
 * `token.info` 里摘掉，不会泄漏给 Shiki。
 *
 * ## 两条边界
 *
 * 1. **`::: code-group` 里的代码块不加头部**：那层已经有标签条（tab），
 *    标签条上写的就是文件名，再加一条会重复。
 * 2. **不碰非页面 Markdown**（个人简介等走裸 markdown-it，没有 VitePress 的
 *    `<div class="language-*">` 包装）：匹配不到包装就原样返回。
 */

/* ------------------------------------------------------------------ *
 * 零、类型：只声明本文件用到的成员
 * ------------------------------------------------------------------ */

/**
 * 只描述我们实际读写的部分。理由与 `markdown-plugins.ts` 顶部相同：
 * `markdown-it`、`@types/markdown-it` 与 VitePress 内联声明是**三份互不兼容的
 * 类型**，用结构类型只描述用到的成员，三份都能传进来。
 */
interface TokenLike {
  type: string
  info: string
}

/** fence 渲染规则的签名（宽松到不影响调用即可，返回值才是契约）。 */
type FenceRule = (
  tokens: TokenLike[],
  idx: number,
  options: unknown,
  env: unknown,
  self: unknown,
) => string

interface MarkdownItLike {
  renderer: {
    rules: Record<string, FenceRule | undefined>
  }
}

/* ------------------------------------------------------------------ *
 * 一、解析围栏信息
 * ------------------------------------------------------------------ */

/** 第一个 `[路径]`。VitePress 的代码分组用同一套语法。 */
const FILE_RE = /\[([^[\]\n]+)\]/

/**
 * 从围栏的 info 字符串里取出文件路径。
 *
 * ` ```ts [src/app.ts] ` → `src/app.ts`；没写则返回 `null`。
 * 允许反斜杠（Windows 相对路径）与中文文件名；首尾空白会被去掉。
 */
export function parseCodeFile(info: string): string | null {
  const match = FILE_RE.exec(info)
  const file = match?.[1]?.trim()
  return file ? file : null
}

/**
 * 扩展名 → Shiki 语言 id。
 *
 * 用途：` ``` [src/app.ts] ` 这种**只写路径、没写语言**的代码块也能正确高亮。
 * 只登记常见语言；查不到就保持无高亮（VitePress 会退回纯文本），
 * 不要为了「猜对」把表堆成百科。
 */
const EXTENSION_LANG: Record<string, string> = {
  ts: 'ts',
  mts: 'ts',
  cts: 'ts',
  tsx: 'tsx',
  js: 'js',
  mjs: 'js',
  cjs: 'js',
  jsx: 'jsx',
  vue: 'vue',
  svelte: 'svelte',
  md: 'md',
  markdown: 'md',
  json: 'json',
  jsonc: 'jsonc',
  json5: 'json5',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  svg: 'xml',
  py: 'python',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'fish',
  ps1: 'powershell',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  conf: 'ini',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  rb: 'ruby',
  sql: 'sql',
  lua: 'lua',
  dart: 'dart',
  scala: 'scala',
  r: 'r',
  tex: 'latex',
  proto: 'proto',
  graphql: 'graphql',
  gql: 'graphql',
  diff: 'diff',
  patch: 'diff',
}

/**
 * 由文件路径推语言 id。
 *
 * 只看**最后一段的扩展名**（`assets/app.min.js` → `js`）；
 * 没有扩展名或不在表里返回 `null`。
 */
export function inferLangFromPath(file: string): string | null {
  const name = file.split(/[\\/]/).pop() ?? ''
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return null

  return EXTENSION_LANG[name.slice(dot + 1).toLowerCase()] ?? null
}

/**
 * 从 info 里判断「作者到底写没写语言名」。
 *
 * VitePress 自己也会做一次类似解析（`extractLang`），但它容忍的写法比我们多
 * （`:line-numbers`、`{1,3}`、`-vue` 等），这里只判断**第一段是不是语言名**：
 * 以 `[`、`{`、`:` 开头或为空都当成「没写」。
 */
function hasExplicitLang(info: string): boolean {
  let rest = info.trim()
  // 去掉文件路径标记，避免把 `[src/a.ts]` 当成语言
  rest = rest.replace(FILE_RE, '').trim()
  if (!rest) return false
  return !/^[[{:]/.test(rest)
}

/* ------------------------------------------------------------------ *
 * 二、注入头部标记
 * ------------------------------------------------------------------ */

/** 最小 HTML 转义（路径可能包含 `&`、`<`、引号）。 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * VitePress fence 包装器的开头。
 *
 * 语言段允许为空：**不写语言的围栏**（` ``` ` 直接换行）会生成
 * `class="language- vp-adaptive-theme"`，这类块同样要有头部（否则复制按钮会
 * 掉进普通文档流、在代码上方另起一行）。
 */
const WRAPPER_RE = /^<div class="(language-[^\s"]*)([^"]*)">/

/**
 * 把「头部控件区」需要的标记注入 VitePress 已经生成的 HTML。
 *
 * 输出结构（**这是给 CSS 与 RSS 清洗器共用的契约**）：
 *
 * ```html
 * <div class="code-block code-block--file language-ts">
 *   <span class="code-block__label" data-file="src/app.ts" title="src/app.ts">src/app.ts</span>
 *   <button class="copy" title="Copy code"></button>
 *   <span class="lang">ts</span>
 *   <pre class="shiki …">…</pre>
 * </div>
 * ```
 *
 * 只有「有文件路径」的块带 `data-file`——RSS 清洗器靠它决定要不要保留路径行。
 *
 * ## 为什么标签必须插在 `<button>` **前面**
 *
 * VitePress 的复制逻辑写死了 `button.copy` 的**下下个兄弟节点**是 `<pre>`：
 *
 * ```js
 * const sibling = el.nextElementSibling?.nextElementSibling // → <pre>
 * ```
 *
 * 标签若插在 button 与 `.lang` 之间，复制到的就是语言名而不是代码。插在 button
 * 之前既满足这条隐式契约，屏幕阅读器的顺序也更自然（先报文件，再报代码）。
 */
export function injectCodeHeader(html: string, file: string | null): string {
  const wrapper = WRAPPER_RE.exec(html)
  if (!wrapper) return html

  const language = wrapper[1].replace(/^language-/, '')
  // 不写语言的围栏（`language-` 后面为空）也要有可见标识，否则头部左边是空的
  const label = file ?? (language || 'text')
  const fileAttrs = file ? ` data-file="${escapeHtml(file)}" title="${escapeHtml(file)}"` : ''
  const classes = file ? 'code-block code-block--file' : 'code-block'
  const labelMarkup = `<span class="code-block__label"${fileAttrs}>${escapeHtml(label)}</span>`

  let out = html.replace(WRAPPER_RE, `<div class="${classes} ${wrapper[1]}${wrapper[2]}">`)
  /*
   * 插在 `<button>` 之前（见上方「为什么标签必须插在 button 前面」）。
   * 万一将来 VitePress 不再生成复制按钮，退回到 `<pre>` 之前插入——
   * 头部控件区靠 CSS Grid 摆位，标签的 DOM 位置只要还在 wrapper 里就不影响视觉。
   */
  const buttonAt = out.indexOf('<button ')
  const anchor = buttonAt === -1 ? out.indexOf('<pre ') : buttonAt
  if (anchor === -1) return out
  return `${out.slice(0, anchor)}${labelMarkup}${out.slice(anchor)}`
}

/**
 * 当前 fence 是否位于 `::: code-group` 里。
 *
 * 容器 token 是成对的 `container_code-group_open` / `container_code-group_close`
 * （VitePress 的 container 插件生成），用深度计数而不是「往前找最近一个」，
 * 这样嵌套代码分组也不会误判。
 */
export function isInsideCodeGroup(tokens: TokenLike[], idx: number): boolean {
  let depth = 0
  for (let i = 0; i < idx; i += 1) {
    const type = tokens[i]?.type
    if (type === 'container_code-group_open') depth += 1
    else if (type === 'container_code-group_close') depth -= 1
  }
  return depth > 0
}

/* ------------------------------------------------------------------ *
 * 三、装配
 * ------------------------------------------------------------------ */

/**
 * 安装代码块增强。
 *
 * **必须最后装**（`applySiteMarkdown()` 的末尾）：它包裹的是 VitePress 的
 * `preWrapperPlugin`，装得越晚越靠外层，才能拿到「已经包装好、但还没被别的规则
 * 改写过」的 HTML。
 */
export function installCodeBlocks(md: unknown): void {
  const instance = md as MarkdownItLike
  const previous = instance.renderer.rules.fence
  if (!previous) return

  instance.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    if (!token?.info) return previous(tokens, idx, options, env, self)

    const file = parseCodeFile(token.info)
    const inGroup = isInsideCodeGroup(tokens, idx)

    /*
     * 只写路径、没写语言的块：用扩展名补一个语言，交给 VitePress 高亮。
     * 必须在调用 previous **之前** 改写 `token.info`——VitePress 的 fence
     * 包装器从 `token.info` 里取语言，改写晚一步就轮不到它了。
     */
    if (file && !hasExplicitLang(token.info)) {
      const inferred = inferLangFromPath(file)
      if (inferred) token.info = `${inferred} ${token.info.trim()}`
    }

    const html = previous(tokens, idx, options, env, self)

    // 代码分组有 tab 条顶着头部，不再重复；非页面 Markdown 没有包装器，原样返回
    if (inGroup) return html
    return injectCodeHeader(html, file)
  }
}
