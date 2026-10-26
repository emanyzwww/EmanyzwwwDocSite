/**
 * `:::name 参数` 的行切分与参数解析。
 *
 * 这一层只做**字符串处理**（是纯函数，可直接单测）：
 *
 * ```text
 * :::github vuejs/core            →  { name: 'github', positional: ['vuejs/core'], named: {} }
 * :::figure caption="图注里有空格" →  { name: 'figure', positional: [], named: { caption: '图注里有空格' } }
 * :::quote — 某本书                 →  { name: 'quote', positional: ['—', '某本书'], named: {} }
 * ```
 *
 * 块级扫描（找配对围栏、递归解析内部 Markdown）在 `block.ts`，
 * 这里只负责「一行开标签怎么写」这一件事，便于单独测试。
 */

import type { DirectiveArgs } from './registry'

/** 参数解析结果：成功或带原因失败。 */
export type ParseArgsResult = { ok: true; args: DirectiveArgs } | { ok: false; reason: string }

/**
 * 解析开标签的参数部分。
 *
 * @param name 已由块级扫描切出的指令名（小写）
 * @param rest 名字之后的整行剩余内容（可能为空）
 */
export function parseDirectiveArgs(name: string, rest: string): ParseArgsResult {
  const args: DirectiveArgs = { name: name.toLowerCase(), positional: [], named: {} }

  let index = 0
  const source = rest

  while (index < source.length) {
    // 跳过空白
    while (index < source.length && /\s/.test(source[index] ?? '')) index += 1
    if (index >= source.length) break

    const char = source[index]

    // 具名参数：`key=value` 或 `key="value with spaces"`
    const keyMatch = /^([A-Za-z][A-Za-z0-9-]*)=/.exec(source.slice(index))
    if (keyMatch) {
      const key = keyMatch[1] as string
      index += keyMatch[0].length

      const value = readValue(source, index)
      if (!value.ok) return { ok: false, reason: value.reason }
      index = value.next

      if (key in args.named) return { ok: false, reason: `参数 ${key} 重复出现` }
      args.named[key] = value.text
      continue
    }

    // 位置参数：读到空白为止，支持引号包裹
    if (char === '"' || char === "'") {
      const quoted = readQuoted(source, index)
      if (!quoted.ok) return { ok: false, reason: quoted.reason }
      args.positional.push(quoted.text)
      index = quoted.next
      continue
    }

    const start = index
    while (index < source.length && !/\s/.test(source[index] ?? '')) index += 1
    const token = source.slice(start, index)
    if (token) args.positional.push(token)
  }

  return { ok: true, args }
}

/** 读一个参数值：允许 `"..."` / `'...'` / 裸词。 */
function readValue(
  source: string,
  from: number,
): { ok: true; text: string; next: number } | { ok: false; reason: string } {
  const char = source[from]
  if (char === '"' || char === "'") return readQuoted(source, from)

  const start = from
  let index = from
  while (index < source.length && !/\s/.test(source[index] ?? '')) index += 1
  return { ok: true, text: source.slice(start, index), next: index }
}

/** 读引号包裹的值（引号本身不进入结果）。 */
function readQuoted(
  source: string,
  from: number,
): { ok: true; text: string; next: number } | { ok: false; reason: string } {
  const quote = source[from]
  if (quote !== '"' && quote !== "'") return { ok: false, reason: '内部错误：不是引号起始' }

  let index = from + 1
  let text = ''

  while (index < source.length) {
    const char = source[index]
    // 反斜杠转义（只处理被转义的引号与反斜杠本身，足够表达文件路径与引号）
    if (char === '\\' && index + 1 < source.length) {
      text += source[index + 1]
      index += 2
      continue
    }
    if (char === quote) return { ok: true, text, next: index + 1 }

    text += char
    index += 1
  }

  return { ok: false, reason: `引号没有闭合：${source.slice(from)}` }
}

/**
 * 从一行源码切出「指令名 + 参数」。
 *
 * @param line 形如 `:::github vuejs/core` 的整行（已去行尾换行，允许前后空白）
 * @returns 不是指令行时 `null`
 */
export function splitDirectiveLine(line: string): { name: string; rest: string } | null {
  const match = /^\s*:{3,}\s*([A-Za-z][A-Za-z0-9-]*)(.*)$/.exec(line)
  if (!match) return null

  return { name: (match[1] as string).toLowerCase(), rest: (match[2] ?? '').trim() }
}

/**
 * 是否是**只有冒号**的闭合行（`:::`，允许更长或前后空白）。
 *
 * 闭合行不允许带参数——带了通常是作者把开标签写了两遍，
 * 此时按闭合处理会让内部内容神秘消失，所以由调用方报错。
 */
export function isClosingFence(line: string): boolean {
  return /^\s*:{3,}\s*$/.test(line)
}

/** 闭合行是否带了多余内容（用于给出「闭合标签不能带参数」的明确报错）。 */
