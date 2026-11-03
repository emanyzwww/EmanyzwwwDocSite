/**
 * frontmatter 的序列化与规范化。
 *
 * 为什么不用 `gray-matter` 自带的 `stringify()`：它会重新生成块状 YAML，
 * 把现有的单行数组 `tags: ['随笔']` 摊成多行、给所有字符串加引号，
 * 于是 `pnpm doc fix` 一跑就是满屏 diff，作者根本看不出改了什么。
 *
 * 这里手写序列化，只为满足一个目标：**输出的字节与仓库现有文章一致**。
 * 现有的 `hello-world/index.md` 就是事实标准——
 *
 *   ---
 *   title: 你好，世界
 *   date: 2026-10-19T04:09:28+08:00
 *   tags: ['随笔']
 *   description: 一句话摘要。
 *   ---
 *
 * 注意：这里只做「写」，读仍然交给 `gray-matter`（它处理 YAML 解析已经足够好，
 * 没必要自己再写一个解析器）。
 */

import { formatZonedIso } from './dates'
import {
  DEPRECATED_FRONTMATTER_KEYS,
  FRONTMATTER_FIELDS,
  FRONTMATTER_KEYS,
  type FrontmatterField,
  type FrontmatterKey,
} from './frontmatter-schema'
import { SITE_TIME_ZONE } from './site'

/** 项目的 frontmatter 风格。 */
export interface FrontmatterStyleOptions {
  /** 数组是否内联成 `['a', 'b']`（`true`，与现有文章一致）还是块状（`false`）。 */
  inlineArrays?: boolean
  /**
   * 字符串是否一律加单引号。
   *
   * 默认 `true`：标题、slug、摘要、标签项统一带引号，方便解析、也避免
   * `title: 标题: 副标题` 这类裸标量歧义。日期与布尔值仍写裸值。
   */
  quoteAllStrings?: boolean
}

/**
 * 取出文件里 frontmatter 区块的**原始文本**（不含两条 `---` 分隔行）。
 *
 * 为什么需要它：`gray-matter` 会把 `date: 2026-10-19T04:09:28+08:00` 解析成
 * `Date` 对象，原始字面量就此丢失。于是「这个日期是否已经带了时区」这个问题
 * 从解析后的 `data` 里**永远看不出答案**（`typeof data.date` 是 `object`），
 * `fix` 会误判成「需要规范化」并把每个文件都重写一遍。
 */
export function rawFrontmatterBlock(raw: string): string {
  const matched = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(raw)
  return matched?.[1] ?? ''
}

/**
 * 取某个标量字段在文件里的**原始字面量**。
 *
 * 只处理单行 `key: value` 形式（本站所有标量字段都是这个形式），
 * 支持去掉包裹的单/双引号；嵌套或多行值返回 `undefined`，交给调用方回退。
 */
export function rawScalarValue(raw: string, key: string): string | undefined {
  const block = rawFrontmatterBlock(raw)
  if (block === '') return undefined

  for (const line of block.split(/\r?\n/)) {
    const matched = new RegExp(`^${key}\\s*:\\s*(.*)$`).exec(line)
    if (!matched) continue

    let value = matched[1].trim()

    // 行尾注释（只在值不是引号包裹时才安全地剥）
    if (!/^['"]/.test(value)) value = value.replace(/\s+#.*$/, '').trim()

    if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
      return value.slice(1, -1).replace(/''/g, "'")
    }
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      return value.slice(1, -1)
    }
    return value
  }

  return undefined
}

/**
 * 一个值写成 YAML 时是否需要引号。
 *
 * YAML 的裸标量限制比多数人以为的多，踩过的坑：
 * - `title: 你好，世界`  OK，但 `title: 标题: 副标题` **必须**加引号（`:` 后跟空格是映射）
 * - `description: a # b` 会被 `#` 截成注释
 * - `title: true` / `date: 2026` 会被解析成布尔 / 数字
 * - 以 `-` `?` `:` `[` `{` 开头的值会被当成结构标记
 * - 空字符串必须显式写 `''`
 */
export function needsQuoting(value: string): boolean {
  if (value === '') return true

  // 首尾空白必须引起来，否则会被吃掉
  if (value !== value.trim()) return true

  // 形如数字 / 布尔 / null 的字符串要引起来，否则类型会变
  if (/^(?:true|false|null|~|yes|no|on|off)$/i.test(value)) return true
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) return true

  // 以结构标记开头
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(value)) return true

  // 含 `: `（映射）、` #`（注释）、换行、制表符
  if (/:\s/.test(value) || / #/.test(value) || /[\n\r\t]/.test(value)) return true

  // 结尾是冒号也危险（会被当成映射的键）
  if (value.endsWith(':')) return true

  return false
}

/** 按需给字符串加单引号（内部单引号转义成两个）。 */
function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/** 序列化一个字符串标量。 */
function serializeString(value: string): string {
  return needsQuoting(value) ? quote(value) : value
}

/**
 * 序列化标签数组：默认内联 `['a', 'b']`，空数组写 `[]`。
 *
 * 标签**一律加单引号**，与仓库现有文章（`tags: ['随笔']`）保持一致。
 * 不加引号虽然也是合法 YAML，但会让 `pnpm doc fix` 与手写文件的风格分叉，
 * 每次改标签都产生无意义 diff。
 */
function serializeTags(tags: readonly string[], inline: boolean): string {
  if (tags.length === 0) return '[]'
  const items = tags.map((tag) => quote(tag))

  if (!inline) return `\n${items.map((item) => `  - ${item}`).join('\n')}`
  return `[${items.join(', ')}]`
}

/**
 * 把一个字段序列化成 `key: value` 行。
 *
 * 返回 `null` 表示「这个值等于默认值、可以不写」——但那由调用方决定，
 * 本函数只负责格式化，不替调用方做省略决策。
 */
function serializeField(
  field: FrontmatterField,
  value: unknown,
  style: Required<FrontmatterStyleOptions>,
): string {
  if (value === undefined || value === null) return `${field.key}:`

  switch (field.type) {
    case 'boolean':
      return `${field.key}: ${value === true ? 'true' : 'false'}`
    case 'tags': {
      const tags = Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []
      return `${field.key}: ${serializeTags(tags as string[], style.inlineArrays)}`
    }
    /*
     * `date` 必须单独处理：`gray-matter` 会把 YAML 时间戳解析成 `Date` 对象，
     * 直接 `String(date)` 得到的是 `Mon Oct 19 2026 04:09:28 GMT+0800 (...)`——
     * 注释掉的这行**真的写出过**这样的内容，把一个正常的 frontmatter 彻底写坏。
     * 这里改成先用文件的原始字面量（调用方应已规范化），退回时按站点时区格式化。
     */
    case 'datetime': {
      const text = serializeDateValue(value)
      return `${field.key}: ${text}`
    }
    case 'string':
    default: {
      const text = String(value)
      if (text === '' && !style.quoteAllStrings) return `${field.key}: ''`
      return `${field.key}: ${style.quoteAllStrings ? quote(text) : serializeString(text)}`
    }
  }
}

/**
 * 把一个日期值写成 ISO 串。
 *
 * 优先用调用方传入的**字符串**（`fix` 会先规范化再传进来）；
 * 只有在拿到 `Date` 对象时才按站点时区格式化它，绝不 `String(date)`。
 */
function serializeDateValue(value: unknown): string {
  if (typeof value === 'string' && value !== '') return value
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatZonedIso(value, SITE_TIME_ZONE)
  }
  return "''"
}

/**
 * 把 frontmatter 与正文拼回完整文件文本。
 *
 * 字段顺序由 `FRONTMATTER_KEYS` 决定（必填在前），但**额外的未知字段**会原样
 * 追加在后面——`check` 可能允许某些自定义字段，`fix` 不能把它们删掉。
 * 已废弃字段（`hideToc` 等）也保留，删除属于改内容语义，必须由人决定。
 */
export function stringifyFrontmatter(
  data: Record<string, unknown>,
  body: string,
  options: FrontmatterStyleOptions = {},
): string {
  const style: Required<FrontmatterStyleOptions> = {
    inlineArrays: options.inlineArrays ?? true,
    quoteAllStrings: options.quoteAllStrings ?? true,
  }

  const lines: string[] = []

  // 先按规范顺序输出已知字段
  for (const key of FRONTMATTER_KEYS) {
    const value = data[key]
    if (value === undefined) continue
    const field = FRONTMATTER_FIELDS.find((item) => item.key === key)
    if (!field) continue
    lines.push(serializeField(field, value, style))
  }

  // 再追加作者自己写的其它字段，保持原顺序
  for (const [key, value] of Object.entries(data)) {
    if ((FRONTMATTER_KEYS as readonly string[]).includes(key)) continue
    if (value === undefined) continue

    if (Array.isArray(value)) {
      const items = value.map((item) =>
        style.quoteAllStrings ? quote(String(item)) : serializeString(String(item)),
      )
      lines.push(`${key}: [${items.join(', ')}]`)
    } else if (typeof value === 'boolean') {
      lines.push(`${key}: ${value ? 'true' : 'false'}`)
    } else if (value === null) {
      lines.push(`${key}:`)
    } else {
      const text = String(value)
      lines.push(
        `${key}: ${style.quoteAllStrings && text !== '' ? quote(text) : serializeString(text)}`,
      )
    }
  }

  /*
   * 换行风格必须与正文一致，否则会写出「frontmatter 用 LF、正文用 CRLF」的混合文件。
   *
   * 实测环境：仓库没有 .gitattributes，而 `core.autocrlf=true`，
   * 所以**工作区里的 Markdown 是 CRLF、仓库里存的是 LF**。
   * `gray-matter` 原样保留了正文的 CRLF，若这里固定用 `\n` 拼接，
   * 就会得到混合行尾；若把正文的 `\r\n` 也一起改掉，`pnpm doc fix` 就会
   * 把整篇正文都标记成改动（125 行全红），作者根本看不出真正修了什么。
   *
   * 结论：跟随正文的现有风格。新建文件时正文由脚本生成（LF），
   * 因此新文件也是 LF，正好符合 `.oxfmtrc.json` 的 `endOfLine: "lf"`。
   */
  const lineEnding = body.includes('\r\n') ? '\r\n' : '\n'
  const normalizedBody = body.replace(/^(?:\r?\n)+/, '')
  const header = ['---', ...lines, '---'].join(lineEnding)
  return `${header}${lineEnding}${lineEnding}${normalizedBody}`
}

/**
 * 判断一组键是否已经是规范顺序（避免 `fix` 对已合规的文件重写一遍）。
 *
 * 只看**已知字段**的相对顺序：未知字段穿插其中不算乱，
 * 因为强行把用户的扩展字段搬到末尾同样是没必要的 diff。
 */
export function isCanonicalKeyOrder(keyOrder: readonly string[]): boolean {
  const known = keyOrder.filter((key) => (FRONTMATTER_KEYS as readonly string[]).includes(key))
  const expected = FRONTMATTER_KEYS.filter((key) => known.includes(key))
  return known.join('\n') === expected.join('\n')
}

/** 找出已废弃的字段（只提示，不删除）。 */
export function findDeprecatedKeys(data: Record<string, unknown>): { key: string; hint: string }[] {
  return Object.keys(data)
    .filter((key) => key in DEPRECATED_FRONTMATTER_KEYS)
    .map((key) => ({ key, hint: DEPRECATED_FRONTMATTER_KEYS[key] }))
}

/** 找出不属于本站规范、也不在废弃清单里的字段（可能是拼写错误）。 */
export function findUnknownKeys(data: Record<string, unknown>): string[] {
  return Object.keys(data).filter(
    (key) =>
      !(FRONTMATTER_KEYS as readonly string[]).includes(key) &&
      !(key in DEPRECATED_FRONTMATTER_KEYS),
  )
}

/** 取某个字段的类型名，用于错误信息。 */
export function typeOfValue(value: unknown): string {
  if (value instanceof Date) return 'Date'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/**
 * 需要「一律加引号」的字符串字段。
 *
 * `date` 不在此列：它必须是裸时间戳，`gray-matter` 才会解析成 `Date`；
 * 布尔值同理。`tags` 的元素由序列化器单独处理。
 */
const QUOTED_STRING_KEYS = ['title', 'slug', 'description'] as const

/**
 * 找出文件里**没加引号**的字符串字段。
 *
 * `check` 据此提示、`fix` 据此把文件重写成统一带引号的风格。只看单行
 * `key: value`，空值（`key:`）与已经带引号的值都跳过。
 */
export function unquotedStringFields(raw: string): string[] {
  const block = rawFrontmatterBlock(raw)
  if (block === '') return []

  const found: string[] = []
  for (const key of QUOTED_STRING_KEYS) {
    for (const line of block.split(/\r?\n/)) {
      const matched = new RegExp(`^${key}\\s*:\\s*(.*)$`).exec(line)
      if (!matched) continue
      const value = matched[1].trim()
      if (value === '' || value.startsWith("'") || value.startsWith('"')) break
      found.push(key)
      break
    }
  }
  return found
}

/**
 * 把文件拆成「frontmatter 原文 + 正文」。
 *
 * 与 `gray-matter` 的 `matter()` 不同，这里保留 frontmatter 的**原始字节**
 * （引号、字段顺序、行尾都不动），只让调用方替换正文——`doc format`
 * 只排版正文，不能顺手把头部重新序列化。
 *
 * `header` 不含结尾换行；没有 frontmatter 时 `header` 为空串、`body` 是全文。
 */
export function splitFrontmatterRaw(raw: string): { header: string; body: string } {
  const matched = /^(---\r?\n[\s\S]*?\r?\n---[ \t]*)(\r?\n|$)/.exec(raw)
  if (!matched) return { header: '', body: raw }
  return { header: matched[1], body: raw.slice(matched[0].length) }
}

/**
 * 用新的正文拼回文件：frontmatter 原样保留，正文前保证恰好一个空行。
 *
 * `body` 应当已由 `formatMarkdownBody()` 规范化（无前导空行、末尾恰好一个换行）。
 */
export function joinFrontmatter(header: string, body: string): string {
  if (header === '') return body
  const eol = header.includes('\r\n') ? '\r\n' : '\n'
  return `${header}${eol}${eol}${body}`
}

/** 仅供类型检查确保 key 类型被使用。 */
export type { FrontmatterKey }
