/**
 * 终端输出的小工具：颜色、按显示宽度对齐、分组打印。
 *
 * 为什么要自己算「显示宽度」而不是 `String#padEnd`：
 * 中文字符在等宽字体里占 **2 列**，`'你好'.padEnd(6)` 只补 4 个空格，
 * 混排中英文的表格就会歪。这里按东亚宽字符（CJK）规则估宽，
 * 让 `pnpm posts` 的输出在中文标题下依然对齐。
 *
 * 也刻意不引 chalk：颜色只是给终端看的，关掉时应当完全无输出副作用。
 */

/** 是否给输出上色。管道 / 重定向 / `NO_COLOR` 时自动关闭。 */
const COLOR_ENABLED =
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== 'dumb' &&
  (process.env.FORCE_COLOR !== undefined || process.stdout.isTTY === true)

/** ANSI 包装。关闭着色时原样返回。 */
function wrap(text: string, code: number): string {
  return COLOR_ENABLED ? `\u001b[${code}m${text}\u001b[0m` : text
}

/** 常用颜色与字重。 */
export const c = {
  bold: (text: string): string => wrap(text, 1),
  dim: (text: string): string => wrap(text, 2),
  red: (text: string): string => wrap(text, 31),
  green: (text: string): string => wrap(text, 32),
  yellow: (text: string): string => wrap(text, 33),
  blue: (text: string): string => wrap(text, 34),
  magenta: (text: string): string => wrap(text, 35),
  cyan: (text: string): string => wrap(text, 36),
} as const

/**
 * 估算字符串在等宽终端里占的列数。
 *
 * 只做「够用」的判断：CJK、全角标点、谚文、假名算 2 列，其余算 1 列。
 * 组合字符与零宽字符按 0 处理，避免 emoji/变音符把表格撑歪。
 */
export function displayWidth(text: string): number {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0

    // 零宽与组合记号不占列
    if (code === 0x200b || code === 0x200c || code === 0x200d || code === 0xfeff) continue
    if (code >= 0x0300 && code <= 0x036f) continue

    const wide =
      (code >= 0x1100 && code <= 0x115f) || // 谚文字母
      (code >= 0x2e80 && code <= 0x303e) || // CJK 部首、标点
      (code >= 0x3041 && code <= 0x33ff) || // 假名、CJK 兼容
      (code >= 0x3400 && code <= 0x4dbf) || // CJK 扩展 A
      (code >= 0x4e00 && code <= 0x9fff) || // CJK 基本区
      (code >= 0xa000 && code <= 0xa4cf) || // 彝文
      (code >= 0xac00 && code <= 0xd7a3) || // 谚文音节
      (code >= 0xf900 && code <= 0xfaff) || // CJK 兼容表意
      (code >= 0xfe30 && code <= 0xfe6f) || // CJK 兼容形式
      (code >= 0xff00 && code <= 0xff60) || // 全角 ASCII
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1f64f) || // emoji
      (code >= 0x1f900 && code <= 0x1f9ff) ||
      (code >= 0x20000 && code <= 0x3fffd) // CJK 扩展 B 及以上

    width += wide ? 2 : 1
  }
  return width
}

/** 按显示宽度右侧补空格，直到占满 `width` 列。 */
export function padEnd(text: string, width: number): string {
  const pad = width - displayWidth(text)
  return pad > 0 ? text + ' '.repeat(pad) : text
}

/** 按显示宽度左侧补空格。 */
export function padStart(text: string, width: number): string {
  const pad = width - displayWidth(text)
  return pad > 0 ? ' '.repeat(pad) + text : text
}

/** 显示宽度超限时截断并加省略号（用于窄终端下的长标题）。 */
export function truncateByWidth(text: string, maxWidth: number): string {
  if (displayWidth(text) <= maxWidth) return text

  let width = 0
  let result = ''
  for (const char of text) {
    const charWidth = displayWidth(char)
    if (width + charWidth > maxWidth - 1) break
    result += char
    width += charWidth
  }
  return `${result}…`
}

/** 打印一行空行（用于分组之间留白）。 */
export function blank(): void {
  console.log('')
}

/** 打印一个分组标题，如 `2026-10-24 · 2 篇`。 */
export function heading(text: string, suffix?: string): void {
  const tail = suffix ? ` ${c.dim(suffix)}` : ''
  console.log(`${c.bold(text)}${tail}`)
}

/** 打印普通信息行。 */
export function info(text: string): void {
  console.log(text)
}

/** 打印成功信息。 */
export function success(text: string): void {
  console.log(`${c.green('✓')} ${text}`)
}

/** 打印警告（不中断执行）。 */
export function warn(text: string): void {
  console.log(`${c.yellow('!')} ${text}`)
}

/** 打印错误（通常随后退出）。 */
export function error(text: string): void {
  console.log(`${c.red('✗')} ${text}`)
}

/**
 * 把二维数据渲染成对齐的表格文本行。
 *
 * 第一行当作表头。列宽按**显示宽度**计算，因此中英混排也能对齐；
 * 着色在补齐之后才施加，不会破坏列宽。
 *
 * 返回行数组而不是直接打印：调用方需要自行加缩进或做进一步处理。
 */
export function formatTable(
  rows: string[][],
  options: { gap?: number; headerRule?: boolean } = {},
): string[] {
  if (rows.length === 0) return []

  const gap = options.gap ?? 2
  const columnCount = Math.max(...rows.map((row) => row.length))
  const widths: number[] = []
  for (let column = 0; column < columnCount; column += 1) {
    widths[column] = Math.max(...rows.map((row) => displayWidth(row[column] ?? '')))
  }

  const render = (row: string[]): string =>
    widths
      .map((width, column) => padEnd(row[column] ?? '', width))
      .join(' '.repeat(gap))
      .trimEnd()

  const lines: string[] = []
  rows.forEach((row, index) => {
    lines.push(index === 0 ? c.bold(render(row)) : render(row))
    if (index === 0 && options.headerRule) {
      const ruleWidth = widths.reduce((sum, width) => sum + width + gap, 0) - gap
      lines.push(c.dim('─'.repeat(ruleWidth)))
    }
  })

  return lines
}

/**
 * 打印二维表格。
 *
 * 第一行当作表头（加粗，并用一条横线分隔）。
 */
export function table(rows: string[][], indent = ''): void {
  for (const line of formatTable(rows, { headerRule: true })) {
    console.log(indent + line)
  }
}

/** 列出可用选项（用于各命令的 `--help`）。 */
export function helpLines(
  command: string,
  usage: string,
  options: readonly { flag: string; description: string }[],
  examples: readonly string[] = [],
): void {
  console.log(c.bold(`${command}`))
  console.log('')
  console.log(`${c.dim('用法')}  ${usage}`)
  console.log('')
  console.log(c.dim('选项'))
  for (const option of options) {
    console.log(`  ${padEnd(option.flag, 22)}${option.description}`)
  }
  if (examples.length > 0) {
    console.log('')
    console.log(c.dim('示例'))
    for (const example of examples) console.log(`  ${example}`)
  }
}
