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
  const path = typeof state.env.path === 'string' ? state.env.path : ''
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
