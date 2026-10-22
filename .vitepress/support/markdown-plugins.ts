/**
 * 两个自写的 markdown-it 插件：`==高亮==` 与 GFM 任务列表。
 *
 * **为什么不装现成的包**（`markdown-it-mark` / `markdown-it-task-lists`）：
 *
 * 1. 两个包都没有类型声明，而本仓库是 `strict` 的 TS，得额外手写 `.d.ts`；
 * 2. `markdown-it-task-lists` 最后一次发布是 2018 年，输出的 DOM 结构与
 *    可配置项都不受控（是否 disabled、class 名、`<input>` 放哪）；
 * 3. 需求只有两条语法，自写零依赖，升级 VitePress 时不会被第三方包的
 *    peer 版本卡住。
 *
 * **接入点有两处，必须同时接**，否则「页面正文」与「RSS / 侧栏卡片」渲染不一致：
 *
 * - `config.ts` 的 `markdown.config`（页面正文）
 * - `support/markdown.ts` 的 `renderMarkdown`（RSS 全文、个人简介、自定义卡片）
 */

/** `=` 的码点，内联规则据此判断是否是自己要处理的标记。 */
const EQUALS = 0x3d

/** 列表容器的类型，用于给「含任务项」的列表打标记。 */
const LIST_OPEN = new Set(['bullet_list_open', 'ordered_list_open'])
const LIST_CLOSE = new Set(['bullet_list_close', 'ordered_list_close'])

/* ------------------------------------------------------------------ *
 * 零、类型：只声明本文件真正用到的成员
 * ------------------------------------------------------------------ */

/**
 * 为什么不直接 `import type MarkdownIt from 'markdown-it'`：
 *
 * `markdown-it` 自身不带类型，只能靠 `@types/markdown-it`。而该包同时提供
 * CJS（`dist/index.cjs.d.ts`）与 ESM（`lib/index.d.mts`）两套声明，VitePress
 * 的 `.d.ts` 里又**内联了第三份**。三份的 `utils` 成员不一致（典型差异：
 * `isPunctCharCode`），导致「我们的插件」与「VitePress 的 `config` 钩子」
 * 参数类型对不上（TS2322），并且 ESM 那份没有 namespace，写不出
 * `MarkdownIt.StateInline`（TS2702）。
 *
 * 与其跟着上游的类型打包方式漂移，不如在这里描述**自己实际调用的那部分**：
 * 结构化类型只看成员是否齐全，三份 MarkdownIt 都满足，两边都不需要断言。
 * 代价是这些接口要随着插件用到的 API 手工维护——数量少，可控。
 */

/** 规则链（`ruler` / `ruler2`），只用 `before` 与 `after`。 */
interface Ruler<Rule> {
  before(beforeName: string, ruleName: string, rule: Rule): void
  after(afterName: string, ruleName: string, rule: Rule): void
}

/** token 上我们读写到的字段。 */
interface TokenLike {
  type: string
  tag: string
  nesting: -1 | 0 | 1
  content: string
  markup: string
  meta: Record<string, unknown> | null
  children: TokenLike[] | null
  attrJoin(name: string, value: string): void
  attrGet(name: string): string | null
}

/** 强调类标记的分隔符记录（`==` 与 `~~` 共用同一套机制）。 */
interface Delimiter {
  marker: number
  length: number
  token: number
  end: number
  open: boolean
  close: boolean
}

/** 内联解析状态里我们用到的部分。 */
interface InlineState {
  src: string
  pos: number
  tokens: TokenLike[]
  tokens_meta: Array<{ delimiters: Delimiter[] } | null>
  delimiters: Delimiter[]
  push(type: string, tag: string, nesting: -1 | 0 | 1): TokenLike
  scanDelims(
    start: number,
    canSplitWord: boolean,
  ): {
    can_open: boolean
    can_close: boolean
    length: number
  }
}

/** 核心规则状态里我们用到的部分。 */
interface CoreState {
  tokens: TokenLike[]
  Token: new (type: string, tag: string, nesting: -1 | 0 | 1) => TokenLike
}

type InlineRule = (state: InlineState, silent: boolean) => boolean
type InlineRule2 = (state: InlineState) => boolean
type CoreRule = (state: CoreState) => void

/** markdown-it 实例的结构类型：够装我们这两个插件即可。 */
interface MarkdownItLike {
  inline: {
    ruler: Ruler<InlineRule>
    ruler2: Ruler<InlineRule2>
  }
  core: {
    ruler: Ruler<CoreRule>
  }
}

/* ------------------------------------------------------------------ *
 * 一、`==高亮==` → `<mark>`
 * ------------------------------------------------------------------ */

/**
 * `==高亮==` → `<mark>`。
 *
 * 复用 markdown-it 自带的**分隔符机制**（与 `~~删除线~~` 同一套）：
 * 扫描阶段把每对 `==` 压进 `state.delimiters`，`ruler2` 阶段再配对，
 * 配对成功的两个 text token 就地改写成 `<mark>` 的开合标签。
 *
 * 走分隔符而不是「正则找一段包起来」，是因为嵌套与混排都交给 markdown-it
 * 自己处理，下面这些才都能正确渲染：
 *
 * - `==**粗体高亮**==` / `**==粗体里的高亮==**`
 * - `` ==含 `代码` 的高亮== ``
 * - `[==高亮== 链接](https://example.com)`
 * - 表格、引用、列表、标题里的高亮
 *
 * 刻意保持的「不误伤」行为（`tests/markdown-plugins.test.ts` 有覆盖）：
 *
 * - 单个等号：`a == b`、`if (a==b)`、`1 == 1` 原样输出；
 * - 行内代码与代码块里的 `==` 不参与解析（反引号规则先吃掉）；
 * - setext 标题（下一行是 `===`）由块级规则先处理，不受影响；
 * - 未闭合的 `==高亮` 原样输出。
 */

/**
 * 扫描：把等号串切成 `==` 配对，逐个登记为分隔符。
 *
 * `silent` 为真表示只做「这里能不能开始」的试探，此时必须返回 `false`
 * 且不产生任何副作用，否则 markdown-it 的跳读会错位。
 *
 * 三条规则都放在模块作用域而不是 `markPlugin` 内部：它们不捕获任何外部变量，
 * 每次调用插件都重建一遍闭包纯属浪费（lint 也会提示）。
 */
const tokenizeMark: InlineRule = (state, silent) => {
  if (silent) return false
  if (state.src.charCodeAt(state.pos) !== EQUALS) return false

  // canSplitWord = true：允许 `中文==强调==中文` 这种紧贴文字的高亮
  const scanned = state.scanDelims(state.pos, true)
  let length = scanned.length

  // 单个 `=` 不是标记，直接放行给 text 规则
  if (length < 2) return false

  // 奇数个等号（如 `===`）先吐出一个落单的 `=`，剩下的按 `==` 配对，
  // 这样 `a === b` 能原样输出，而不是被吃掉一个字符
  if (length % 2 === 1) {
    const lone = state.push('text', '', 0)
    lone.content = String.fromCharCode(EQUALS)
    length -= 1
  }

  for (let index = 0; index < length; index += 2) {
    const token = state.push('text', '', 0)
    token.content = '=='

    state.delimiters.push({
      marker: EQUALS,
      // length 固定 0：跳过强调规则那套「长度配比」检查
      length: 0,
      token: state.tokens.length - 1,
      end: -1,
      open: scanned.can_open,
      close: scanned.can_close,
    })
  }

  state.pos += scanned.length
  return true
}

/** 配对：把 `end` 指向的成对分隔符就地改成 `<mark>` 开合 token。 */
function pairDelimiters(state: InlineState, delimiters: Delimiter[]): void {
  for (const start of delimiters) {
    if (start.marker !== EQUALS) continue
    if (start.end === -1) continue // 未闭合，保持纯文本

    const end = delimiters[start.end]

    const open = state.tokens[start.token]
    open.type = 'mark_open'
    open.tag = 'mark'
    open.nesting = 1
    open.markup = '=='
    open.content = ''

    const close = state.tokens[end.token]
    close.type = 'mark_close'
    close.tag = 'mark'
    close.nesting = -1
    close.markup = '=='
    close.content = ''
  }
}

/**
 * `ruler2` 阶段会被调用一次，但分隔符可能挂在嵌套的内联层级上
 * （链接文字、图片替代文本等），因此顶层与 `tokens_meta` 都要走一遍。
 */
const postProcessMark: InlineRule2 = (state) => {
  pairDelimiters(state, state.delimiters)

  for (const meta of state.tokens_meta) {
    if (meta?.delimiters) pairDelimiters(state, meta.delimiters)
  }

  // `ruler2` 的规则约定返回布尔值（"是否做过处理"），与 `ruler` 的规则不同
  return true
}

function markPlugin(md: MarkdownItLike): void {
  md.inline.ruler.before('emphasis', 'mark', tokenizeMark)
  md.inline.ruler2.after('emphasis', 'mark', postProcessMark)

  // 故意**不**覆盖渲染规则：默认渲染器会自己输出 `<mark>` 并把 token 上的属性
  // 一起渲染出来。之前写成 `() => '<mark>'` 硬编码字符串，结果 VitePress 的
  // attrs 插件加上的 class（`==高亮=={.big}`）被静默丢掉。
}

/* ------------------------------------------------------------------ *
 * 二、GFM 任务列表
 * ------------------------------------------------------------------ */

/**
 * 在列表项里找到第一个内联块。
 *
 * 紧凑列表（`- [x] 项`）里 `list_item_open` 后面直接就是 `inline`；
 * 松散列表（项之间有空行）会先有一个 `paragraph_open`，因此两种都要跳过。
 */
function firstInlineOf(tokens: TokenLike[], from: number): TokenLike | null {
  let index = from
  if (tokens[index]?.type === 'paragraph_open') index += 1
  return tokens[index]?.type === 'inline' ? tokens[index] : null
}

/** 第一趟：识别并删除标记，同时给列表与列表项打上 class。 */
const collectTaskMarkers: CoreRule = (state) => {
  const { tokens } = state
  /** 当前所在的列表容器，用于给「含有任务项」的列表打标记。 */
  const stack: TokenLike[] = []

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]

    if (LIST_OPEN.has(token.type)) {
      stack.push(token)
      continue
    }

    if (LIST_CLOSE.has(token.type)) {
      stack.pop()
      continue
    }

    if (token.type !== 'list_item_open') continue

    const inline = firstInlineOf(tokens, index + 1)
    if (!inline) continue

    // GFM 要求方括号后必须跟空白；`[x]` 紧贴文字时不算任务项
    const match = /^\[([ xX])\](?:[ \t]+|$)/.exec(inline.content)
    if (!match) continue

    const checked = match[1].toLowerCase() === 'x'
    inline.content = inline.content.slice(match[0].length)

    token.attrJoin('class', 'task-list-item')
    // `meta` 默认是 `null`，必须先初始化才能挂字段
    token.meta = { ...token.meta, taskChecked: checked }

    // 一个列表里可能有多项任务，只用 `attrJoin` 会把同一个 class 叠加多次
    // （`contains-task-list contains-task-list`），所以先看是否已经打过标记
    const list = stack[stack.length - 1]
    if (list && !(list.attrGet('class') ?? '').split(/\s+/).includes('contains-task-list')) {
      list.attrJoin('class', 'contains-task-list')
    }
  }
}

/** 第二趟：在已经解析好的内容前面插入复选框。 */
const renderTaskCheckboxes: CoreRule = (state) => {
  const { tokens } = state

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.type !== 'list_item_open') continue
    if (typeof token.meta?.taskChecked !== 'boolean') continue

    const inline = firstInlineOf(tokens, index + 1)
    if (!inline?.children) continue

    const box = new state.Token('html_inline', '', 0)
    /*
     * 用 `readonly` 而不是 `disabled`：
     *
     * - 语义上它确实是「只读」——静态站点没有后端，勾选状态来自 Markdown 源码，
     *   读者改不了；`readonly` 表达的正是这个意思；
     * - 更实际的原因：Chrome 在 `disabled` 状态下**忽略 `accent-color`**，
     *   复选框被画成灰色，勾选/未勾选几乎分不出来；`readonly` 则保留主题主色。
     *
     * 注意 `readonly` 对 `type="checkbox"` 实际上不阻止点击，所以 CSS 里
     * 给这些复选框加了 `pointer-events: none`，确保读者点不动。
     */
    box.content =
      '<input class="task-list-item-checkbox" type="checkbox" readonly' +
      (token.meta.taskChecked ? ' checked' : '') +
      '>'
    inline.children.unshift(box)
  }
}

function taskListPlugin(md: MarkdownItLike): void {
  md.core.ruler.before('inline', 'task-list-marker', collectTaskMarkers)
  md.core.ruler.after('inline', 'task-list-checkbox', renderTaskCheckboxes)
}

/* ------------------------------------------------------------------ *
 * 三、统一入口
 * ------------------------------------------------------------------ */

/**
 * 给 markdown-it 实例装上本站的扩展语法。
 *
 * 页面正文（`config.ts`）与非页面渲染（`support/markdown.ts`）都调这一个函数，
 * 保证同一段 Markdown 在网页、RSS 全文、侧栏卡片里的结果一致。
 */
export function extendMarkdown(md: MarkdownItLike): void {
  markPlugin(md)
  taskListPlugin(md)
}
