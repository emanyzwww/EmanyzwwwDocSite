/**
 * 块级指令的扫描规则（markdown-it `block.ruler`）。
 *
 * ## 为什么自己写而不是装 `markdown-it-container`
 *
 * 1. `markdown-it-container` 在 pnpm 的严格布局下**不可从项目根解析**
 *    （它被内联进 `vitepress/dist`，`.pnpm` 里没有独立包），要用就得新增一个
 *    devDependency——而本仓库对大依赖的取舍一贯是「自写、零依赖」（见
 *    `support/markdown-plugins.ts` 顶部同一段判断）；
 * 2. 我们要的错误文案它给不了（未知指令要列可用类型 + 拼写纠错）；
 * 3. 它不支持「代码块里的 `:::` 不算围栏」，而文档里必然要写用法示例。
 *
 * ## 与 markdown-it 的接口约定
 *
 * 这是一个标准的 block 规则：命中返回 `true`、并自己推进 `state.line`；
 * `silent` 为真时只回答「这一行能不能开始指令」，不许有副作用。
 */

import { isClosingFence, parseDirectiveArgs, splitDirectiveLine } from './parse'
import type { DirectiveArgs, DirectiveContext } from './registry'
import { getDirective, unknownDirectiveMessage } from './registry'

/* ------------------------------------------------------------------ *
 * 最小结构类型（与仓库其它插件同风格：只声明真正用到的成员）
 * ------------------------------------------------------------------ */

/** 块级状态里我们用到的部分。 */
interface BlockState {
  src: string
  bMarks: number[]
  eMarks: number[]
  tShift: number[]
  sCount: number[]
  blkIndent: number
  line: number
  lineMax: number
  parentType: string
  /** 已产出的 token 序列（`wrapColumns` 会就地增删）。 */
  tokens: BlockToken[]
  push(type: string, tag: string, nesting: -1 | 0 | 1): BlockToken
  md: { block: { tokenize(state: BlockState, startLine: number, endLine: number): void } }
  env: Record<string, unknown>
}

/** 块级 token 里我们用到的部分。 */
interface BlockToken {
  type: string
  content: string
  block: boolean
  map: [number, number] | null
  /**
   * `inline` token 的子节点。
   *
   * 只有 `inline` 有；其余 token 为 `null` 或不填。
   * 声明它是因为 `splitParagraphImages` 要重组图片段落
   * （判断「这一段是不是只有连续图片」必须看 children）。
   */
  children?: BlockToken[] | null
}

/** 规则链。 */
interface BlockRuler {
  before(beforeName: string, ruleName: string, rule: BlockRule, options?: { alt?: string[] }): void
}

/** 可以挂规则的 markdown-it 实例。 */
export interface DirectiveMarkdownIt {
  block: { ruler: BlockRuler }
}

/** block 规则签名。 */
type BlockRule = (state: BlockState, startLine: number, endLine: number, silent: boolean) => boolean

/* ------------------------------------------------------------------ *
 * 扫描
 * ------------------------------------------------------------------ */

/** 取一行的原始文本（不含行尾换行）。 */
function lineText(state: BlockState, line: number): string {
  return state.src.slice(state.bMarks[line] ?? 0, state.eMarks[line] ?? 0)
}

/** 该行在块内的有效缩进（用于判断是否已经跳出当前块）。 */
function lineIndent(state: BlockState, line: number): number {
  return (state.sCount[line] ?? 0) - state.blkIndent
}

/**
 * 遍历时维护的围栏状态。
 *
 * `code`：当前是否在围栏代码块内（``` 或 ~~~）。代码块里的 `:::` 是**内容**，
 * 不是指令围栏——文档里写用法示例全靠这条。
 */
interface ScanState {
  code: boolean
  /** 代码块的围栏字符（` 或 ~）。 */
  codeChar: string
  /** 代码块的围栏长度。 */
  codeLength: number
}

/** 判断一行是否开启/关闭围栏代码块；返回新的扫描状态。 */
function trackCodeFence(state: BlockState, line: number, scan: ScanState): ScanState {
  const text = lineText(state, line).trimStart()
  const match = /^(`{3,}|~{3,})/.exec(text)
  if (!match) return scan

  const fence = match[1] as string
  const char = fence[0] as string

  if (!scan.code) {
    return { code: true, codeChar: char, codeLength: fence.length }
  }

  // 关闭：字符相同、长度不短于开启围栏（CommonMark 规定）
  if (char === scan.codeChar && fence.length >= scan.codeLength) {
    return { code: false, codeChar: '', codeLength: 0 }
  }

  return scan
}

/** 找到与 `startLine` 配对的闭合行下标；未闭合返回 `-1`。 */
function findClosingLine(state: BlockState, startLine: number, endLine: number): number {
  let scan: ScanState = { code: false, codeChar: '', codeLength: 0 }
  let depth = 0

  for (let line = startLine + 1; line < endLine; line += 1) {
    const before = scan
    scan = trackCodeFence(state, line, scan)

    // 刚进入或刚离开代码块的那一行，本身不是指令围栏
    if (scan.code !== before.code) continue
    if (scan.code) continue

    // 缩进已经跳出当前块：指令被容器截断，按未闭合处理
    if (lineIndent(state, line) < 0 && lineText(state, line).trim() !== '') return -1

    const text = lineText(state, line)

    if (splitDirectiveLine(text)) {
      depth += 1
      continue
    }

    if (isClosingFence(text)) {
      if (depth === 0) return line
      depth -= 1
    }
  }

  return -1
}

/* ------------------------------------------------------------------ *
 * 分栏
 * ------------------------------------------------------------------ */

/** 造一个 html_block token（纯数据，不经过 `state.push`）。 */
function htmlBlock(content: string): BlockToken {
  return { type: 'html_block', content, block: true, map: null }
}

/**
 * 把 `split: 'hr'` 指令的内部 token 按 `<hr>` 切成若干列。
 *
 * ## 做法
 *
 * 内部已经 tokenize 完毕，token 序列形如：
 *
 * ```text
 * html_block(开标签)
 *   paragraph_open / inline / paragraph_close      ← 第 1 列
 *   hr                                             ← 分隔符
 *   paragraph_open / inline / paragraph_close      ← 第 2 列
 * html_block(闭标签)
 * ```
 *
 * 这里就地插入 `.embed__column` 的包裹 html_block：
 *
 * ```text
 * html_block(<div class="embed__column">)   ← 第 1 列开始
 *   …第 1 列内容…
 * html_block(</div><div class="embed__column">)  ← 第 1 列结束 + 第 2 列开始
 *   …第 2 列内容…
 * html_block(</div>)                        ← 最后一列结束
 * ```
 *
 * ## 边界
 *
 * - 首尾的 `hr`（作者多写了分隔线）会被丢掉，不产生空列；
 * - 一个 `hr` 都没有时退化成单列——作者想要一列就没必要分栏，但也不该报错。
 *
 * @param state 块级状态（`tokens` 会被就地修改）
 * @param openingTokenIndex 开标签在 `state.tokens` 里的下标
 */
function wrapColumns(state: BlockState, openingTokenIndex: number): void {
  const tokens = state.tokens
  const openToken = tokens[openingTokenIndex]
  if (!openToken) return

  /** 本指令产生的 token 区间：开标签之后、闭标签之前。 */
  const bodyStart = openingTokenIndex + 1
  /*
   * 闭标签是最后 push 的，所以正文区间是 [bodyStart, tokens.length - 1)。
   * 用 `-1` 精确排除它——列包裹必须夹在开标签与闭标签之间。
   */
  const bodyEnd = tokens.length - 1

  /** 收集分隔符下标（`hr` 且位于本指令内部）。 */
  const separators: number[] = []
  for (let index = bodyStart; index < bodyEnd; index += 1) {
    if (tokens[index]?.type === 'hr') separators.push(index)
  }

  // 没有任何分隔符：退化成单列，不额外包裹（避免空 div 影响布局）
  if (separators.length === 0) return

  /*
   * 逐个把 `hr` 就地改写成「关上一列 + 打开下一列」。
   *
   * 改 `type` 而不是插入新 token：`hr` 的位置正好是两列的分界，
   * 就地替换让下标全部保持稳定（不需要从后往前也能正确工作）。
   */
  for (const index of separators) {
    const separator = tokens[index]
    if (!separator) continue
    separator.type = 'html_block'
    separator.content = '</div><div class="embed__column">'
  }

  /*
   * 首尾包裹。
   *
   * 从后往前插：先插尾部（下标大），再插头部——否则头部插入会让尾部下标失效。
   */
  tokens.splice(bodyEnd, 0, htmlBlock('</div>'))
  tokens.splice(bodyStart, 0, htmlBlock('<div class="embed__column">'))
}

/* ------------------------------------------------------------------ *
 * 图片拆段
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * 报错
 * ------------------------------------------------------------------ */

/** 构建期报错前缀，便于在 VitePress 的日志里一眼找到来源。 */
const ERROR_PREFIX = '[directives]'

/** VitePress 内置容器的类型名（见 `markdown.config` 的容器插件）。 */
const BUILTIN_CONTAINERS = new Set(['tip', 'info', 'warning', 'danger', 'details'])

/**
 * 判断某个指令是否落在 VitePress 内置容器内部。
 *
 * 做法：从块开头往上找最近的、未闭合的内置容器开标签。
 * 只看一层就够——多层嵌套时最内层那个才是原因，而报错信息里给出任意一层
 * 都足以让作者意识到"是容器抢先闭合"。
 *
 * @returns 命中的容器名（`tip` 等），没有则 `null`
 */
function detectBuiltinContainer(state: BlockState, startLine: number): string | null {
  for (let line = startLine - 1; line >= 0; line -= 1) {
    // 越过当前块的上边界就停止（指令在列表/引用里时不应看到更外层的容器）
    if (lineIndent(state, line) < 0) return null

    const text = lineText(state, line).trim()
    const open = /^:{3,}\s*([A-Za-z][A-Za-z0-9-]*)/.exec(text)
    if (!open) continue

    const name = (open[1] ?? '').toLowerCase()
    // 内置容器才是冲突来源；我们自己的指令在 `findClosingLine` 里已经正确处理过
    if (BUILTIN_CONTAINERS.has(name)) return name
  }

  return null
}

/** 由行号拼出「文件:行」，构建期能直接定位。 */
function locate(state: BlockState, line: number): string {
  // 文章页面经过 rewrites 后 `env.path` 是 route 路径（磁盘上不存在），
  // 报错要指向真实的源文件，所以优先用 `env.realPath`
  const env = state.env as { path?: string; realPath?: string }
  const path = typeof env.realPath === 'string' ? env.realPath : (env.path ?? '')
  const file = path ? path.replace(/\\/g, '/') : '<unknown>'
  return `${file}:${line + 1}`
}

/** 抛给作者的错误：带上位置与原始行，便于直接跳过去。 */
function fail(state: BlockState, line: number, message: string): never {
  const preview = lineText(state, line).trim()
  throw new Error(`${ERROR_PREFIX} ${locate(state, line)}\n${message}\n\n    ${preview}`)
}

/* ------------------------------------------------------------------ *
 * 规则
 * ------------------------------------------------------------------ */

/**
 * 扫描一条 `:::name` 指令块。
 *
 * 命中时会自己 tokenize 内部 Markdown（因此指令内部可以用任意 Markdown：
 * 列表、代码块、图片、甚至嵌套另一个指令）。
 */
function createRule(): BlockRule {
  return (state, startLine, endLine, silent) => {
    const first = lineText(state, startLine)
    const head = splitDirectiveLine(first)

    // 不是指令开头：交回给后面的规则（段落、列表…）
    if (!head) return false

    /*
     * `silent` 是「这里能不能开始一个块」的试探。
     * 必须返回 true 且不产生任何副作用——markdown-it 的跳读依赖这一点。
     */
    if (silent) return true

    const closingLine = findClosingLine(state, startLine, endLine)
    if (closingLine === -1) {
      /*
       * 两种常见原因，报错要点明是哪一种，否则作者会一直盯着"明明写了 :::"。
       *
       * 1. 真的忘了收尾；
       * 2. **放在了 VitePress 内置容器里**（`::: tip` / `::: warning` …）。
       *    内置容器由 VitePress 自己的插件处理，它会把遇到的**第一个** `:::`
       *    当成自己的闭合行——于是内层指令永远等不到属于自己的那一行。
       *    这不是我们能在指令层修的（顺序在它之后），只能明确告知作者。
       */
      const inBuiltinContainer = detectBuiltinContainer(state, startLine)
      const hint = inBuiltinContainer
        ? `\n  这个指令位于 VitePress 内置容器（${inBuiltinContainer}）内部。\n` +
          '  内置容器与指令共用 `:::` 围栏，嵌套时内置容器会抢先闭合，\n' +
          '  导致内层指令永远等不到自己的收尾行。\n' +
          '  解决办法：把指令移到容器外面，或去掉外层的内置容器。'
        : '\n  在指令内容结束后单独写一行 ::: 收尾；指令可以嵌套，但每个都要配对。'

      fail(state, startLine, `指令 :::${head.name} 没有闭合。${hint}`)
    }

    const directive = getDirective(head.name)
    if (!directive) fail(state, startLine, unknownDirectiveMessage(head.name))

    const parsed = parseDirectiveArgs(head.name, head.rest)
    if (!parsed.ok) {
      fail(state, startLine, `指令 :::${head.name} 的参数无法解析：${parsed.reason}`)
    }

    const args: DirectiveArgs = parsed.args
    const context: DirectiveContext = {
      location: locate(state, startLine),
    }

    /*
     * 指令分两种形态：
     *
     * - `body: 'none'`   —— 无正文，渲染成一整块 HTML（github / link）
     * - `body: 'markdown'` —— 有正文，内部 Markdown 递归解析后被包在外壳里
     *                         （figure / quote）
     *
     * 两种都由指令自己产出开/闭标签，这里只负责「把内部 token 插进去」。
     * 用 html_block 而不是自定义 token + renderer 规则：HTML 片段是我们
     * 自己拼的完整字符串，不需要再经过 renderer 的分支。
     */
    const open = directive.open(args, context)
    const close = directive.close(args, context)

    const openingTokenIndex = state.tokens.length
    const openToken = state.push('html_block', '', 0)
    openToken.content = open
    openToken.block = true
    openToken.map = [startLine, closingLine + 1]

    if (directive.body === 'markdown') {
      const oldMax = state.lineMax
      const oldParent = state.parentType
      // 限制在围栏内部，避免内部段落的惰性续行越过闭合行
      state.lineMax = closingLine
      state.parentType = 'directive'
      state.md.block.tokenize(state, startLine + 1, closingLine)
      state.lineMax = oldMax
      state.parentType = oldParent
    }

    if (close) {
      const closeToken = state.push('html_block', '', 0)
      closeToken.content = close
      closeToken.block = true
      closeToken.map = null
    }

    /*
     * `split: 'hr'` —— 把正文里的 `<hr>` 当作「列分隔符」。
     *
     * 内部 Markdown 已经把 `---` 解析成了 `hr` token，这里只需把它换成
     * 「关上一列 / 打开下一列」的两段 HTML。放在 tokenize **之后**做，
     * 而不是提前切源码：这样每一列内部仍然是完整的 Markdown 解析
     * （列表、代码块、嵌套指令都不受影响）。
     *
     * **必须排在 close 之后**：闭标签也是 `html_block`，它要留在
     * 列包裹的外面（`<div class="embed__columns">…列…</div>` 才是完整的）。
     * 早一步调用会把 `</div>` 塞到闭标签内侧，产生错误的嵌套。
     */
    if (directive.split === 'hr') wrapColumns(state, openingTokenIndex)

    /*
     * `splitImages` —— 登记本指令的正文区间，实际拆分交给 core 阶段的规则。
     *
     * **不能在块级做**：块级规则运行时 `inline.children` 还是 `null`
     * （inline 解析发生在稍后的 core 阶段），此时根本看不到图片。
     * 这里只把「哪一段 token 需要拆」记到 env 上，`installSplitImagesRule()`
     * 在 `inline` 之后按区间处理。
     */
    if (directive.splitImages) {
      const ranges = (state.env.splitImageRanges ??= []) as Array<[number, number]>
      ranges.push([openingTokenIndex, state.tokens.length - 1])
    }

    state.line = closingLine + 1
    return true
  }
}

/**
 * 安装指令规则。
 *
 * 必须挂在 `fence` **之前**：否则围栏代码块会把 `:::` 行当成代码内容
 * （我们自己的围栏状态机就白写了）。`alt` 里的类型表示「本规则可能从这些
 * 块的中间开始接管」，与 markdown-it-container 的声明一致。
 */
export function installDirectiveRule(md: DirectiveMarkdownIt): void {
  md.block.ruler.before('fence', 'directive', createRule(), {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  })
}
