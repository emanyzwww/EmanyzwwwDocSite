/**
 * 正文 Markdown 排版（`pnpm doc format`）。
 *
 * 只做**可预测、可逆**的空白整理，不碰语义：
 * - 清除纯空白行的空格、行尾多余空白（行尾两个空格视为硬换行，保留）；
 * - 连续空行折叠成一行；
 * - `##标题` → `## 标题`，标题前后各一行空行；
 * - 行首无序列表符号 `*` / `+` 统一成 `-`；
 * - 文件开头/结尾不留空行，末尾恰好一个换行。
 *
 * 明确不动：代码围栏内的内容、`:::` 指令块、行内代码、表格列宽、
 * 引用/HTML 块、链接与图片语法、中文标点。
 *
 * 返回的 `text` 保留原文件的换行风格（LF / CRLF），方便直接写回。
 */

/** 排版结果。 */
export interface FormatResult {
  /** 规范化后的正文；空正文返回空串。 */
  text: string
  /** 是否有变化。 */
  changed: boolean
  /** 粗略的变化行数，仅用于提示。 */
  changedLines: number
}

/** 一行的分类。 */
type LineKind = 'code' | 'fence-open' | 'fence-close' | 'heading' | 'blank' | 'other'

/** 一行的中间状态。 */
interface LineInfo {
  text: string
  kind: LineKind
}

/** 打开围栏的正则：最多 3 个前导空格 + 至少 3 个反引号/波浪号。 */
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/

/** 标题：行首 1–6 个 `#`，后面紧跟非空白、非 `#` 的正文。 */
const HEADING_RE = /^(#{1,6})([ \t]*)([^#\s].*)$/

/** 行首无序列表符号。 */
const BULLET_RE = /^([ \t]*)([*+])([ \t]+)(.*)$/

/** 行尾硬换行（两个及以上空格）。 */
const HARD_BREAK_RE = /[^ \t] {2,}$/

/**
 * 处理围栏之外的行。
 *
 * @param line     原始行
 * @param hardBreak 下一行非空且本行以两个空格结尾：保留行尾空白
 */
function normalizeLine(line: string, hardBreak: boolean): string {
  const blank = /^[ \t]*$/.test(line)
  if (blank) return ''

  let text = line

  // 标题：`##标题` / `##  标题` → `## 标题`
  const heading = HEADING_RE.exec(text)
  if (heading) {
    text = `${heading[1]} ${heading[3].trimEnd()}`
  } else {
    // 无序列表符号统一成 `-`
    const bullet = BULLET_RE.exec(text)
    if (bullet) text = `${bullet[1]}-${bullet[3]}${bullet[4]}`
  }

  // 硬换行保留行尾空格；其它行去掉尾随空白
  return hardBreak ? text : text.replace(/[ \t]+$/, '')
}

/**
 * 排版一段正文。
 *
 * 输入是 `gray-matter` 解析出的 `body`（不含 frontmatter）。
 */
export function formatMarkdownBody(body: string): FormatResult {
  const eol = body.includes('\r\n') ? '\r\n' : '\n'
  const normalized = body.replace(/\r\n/g, '\n')
  const rawLines = normalized.split('\n')

  // ---------- 第一遍：分类 + 行内规范化，代码围栏内原样保留 ----------
  const lines: LineInfo[] = []
  let fence: { char: string; length: number } | null = null

  for (let index = 0; index < rawLines.length; index += 1) {
    const line = rawLines[index] ?? ''

    if (fence) {
      // 反引号与波浪号都不是正则元字符，直接拼即可
      const close = new RegExp(`^ {0,3}${fence.char}{${fence.length},}\\s*$`).exec(line)
      if (close) {
        lines.push({ text: line, kind: 'fence-close' })
        fence = null
      } else {
        lines.push({ text: line, kind: 'code' })
      }
      continue
    }

    const open = FENCE_OPEN_RE.exec(line)
    if (open) {
      const marker = open[1] ?? '```'
      fence = { char: marker[0] ?? '`', length: marker.length }
      lines.push({ text: line, kind: 'fence-open' })
      continue
    }

    if (/^[ \t]*$/.test(line)) {
      lines.push({ text: '', kind: 'blank' })
      continue
    }

    if (HEADING_RE.test(line)) {
      lines.push({ text: normalizeLine(line, false), kind: 'heading' })
      continue
    }

    const next = rawLines[index + 1]
    const hardBreak = next !== undefined && next.trim() !== '' && HARD_BREAK_RE.test(line)
    lines.push({ text: normalizeLine(line, hardBreak), kind: 'other' })
  }

  // 围栏没闭合：内容保持原样，只把标题/列表的规范化结果收下
  const out: string[] = []
  let pendingBlank = false
  let needBlankAfter = false

  for (const { text, kind } of lines) {
    if (kind === 'code') {
      out.push(text)
      continue
    }

    if (kind === 'blank') {
      pendingBlank = true
      continue
    }

    // 标题、围栏、普通段落之间：需要空行就现在补
    if (out.length > 0 && out[out.length - 1] !== '' && (pendingBlank || needBlankAfter)) {
      out.push('')
    }
    pendingBlank = false
    needBlankAfter = false

    out.push(text)

    if (kind === 'heading' || kind === 'fence-close') {
      needBlankAfter = true
    }
  }

  // 去掉末尾空行，保证恰好一个换行
  while (out.length > 0 && out[out.length - 1] === '') out.pop()

  const formatted = out.join('\n')
  const text = formatted === '' ? '' : `${formatted.replace(/\n/g, eol)}${eol}`
  const changed = text !== body

  return {
    text,
    changed,
    changedLines: changed ? countChangedLines(normalized, formatted) : 0,
  }
}

/** 粗略统计变化行数（行数差 + 同位置不同的行）。 */
function countChangedLines(before: string, after: string): number {
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')
  let changed = Math.abs(beforeLines.length - afterLines.length)
  const shared = Math.min(beforeLines.length, afterLines.length)
  for (let index = 0; index < shared; index += 1) {
    if (beforeLines[index] !== afterLines[index]) changed += 1
  }
  return changed
}
