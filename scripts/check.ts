/**
 * `pnpm check` —— 检查内容与 frontmatter 是否合规。
 *
 * 只检查、不修改。可修的问题交给 `pnpm fix`。
 *
 * 检查项分成两级：
 * - **error**：会让内容出错或无法构建（缺 `title`、`date` 不可解析、标签不是数组）
 * - **warn**：能构建但不合规范（字段顺序乱、日期没带时区、目录日期与 frontmatter 不一致、
 *   用了废弃字段、slug 有空格或方括号）
 *
 * 退出码：有 error 时为 1（可直接接进 CI 门禁），只有 warn 时为 0。
 */

import { REQUIRED_FRONTMATTER_KEYS } from '../.vitepress/data/frontmatter'
import { hasOption, optionValue, parseArgs, wantsHelp } from './lib/args'
import { isoDateInZone } from './lib/dates'
import {
  findDeprecatedKeys,
  findUnknownKeys,
  isCanonicalKeyOrder,
  rawScalarValue,
  typeOfValue,
} from './lib/frontmatter'
import { collectPostFiles, postDate } from './lib/posts'
import type { PostFile } from './lib/posts'
import { parseLocale, SITE_TIME_ZONE } from './lib/site'
import { blank, c, helpLines, info, success } from './lib/ui'

/** 选项定义。 */
const SPECS = [
  { name: 'lang', short: 'l' },
  { name: 'all', boolean: true },
  { name: 'strict', boolean: true },
  { name: 'help', short: 'h', boolean: true },
] as const

/** 帮助。 */
function printHelp(): void {
  helpLines(
    'pnpm check',
    'pnpm check [选项]',
    [
      { flag: '-l, --lang <code>', description: '只检查某种语言（默认全部）' },
      { flag: '--all', description: '同时检查非文章页面（about、tags 等）' },
      { flag: '--strict', description: '把 warn 也当作失败（退出码 1）' },
      { flag: '-h, --help', description: '显示本帮助' },
    ],
    ['pnpm check', 'pnpm check -l=zh-cn --strict'],
  )
}

/** 一条检查结果。 */
interface Finding {
  level: 'error' | 'warn'
  file: string
  message: string
}

/**
 * 去掉代码块与行内代码，返回「真正的正文」。
 *
 * 为什么要做这一步：`hello-world/index.md` 里有一个 Python 代码块，
 * 首行是 `# Python 代码高亮测试`。直接对全文跑 `/^#\s+\S/m` 会命中它，
 * `check` 于是报告「正文里有 H1」——**这是一条假警报**，实测过。
 * 注释里的 `#` 与 Markdown 标题无关，必须先剔掉围栏代码。
 */
function stripCodeBlocks(markdown: string): string {
  return (
    markdown
      // 围栏代码块（``` 或 ~~~，允许更长围栏与信息串）
      .replace(/^(\s*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\2\s*$/gm, '')
      // 未闭合的围栏：从围栏到文件末尾都算代码
      .replace(/^(\s*)(`{3,}|~{3,})[^\n]*\n[\s\S]*$/m, '')
      // 行内代码
      .replace(/`[^`\n]*`/g, '')
  )
}
function checkPost(post: PostFile, findings: Finding[]): void {
  const file = post.path.filePath
  const data = post.data

  // ---------- 必填字段 ----------
  for (const key of REQUIRED_FRONTMATTER_KEYS) {
    const value = data[key]
    if (value === undefined || value === null || value === '') {
      findings.push({ level: 'error', file, message: `缺少必填字段 ${key}` })
    }
  }

  // ---------- title 类型 ----------
  if (data.title !== undefined && typeof data.title !== 'string') {
    findings.push({
      level: 'error',
      file,
      message: `title 应为字符串，实际是 ${typeOfValue(data.title)}`,
    })
  } else if (typeof data.title === 'string' && data.title.trim() === '') {
    findings.push({ level: 'error', file, message: 'title 为空' })
  }

  // ---------- date 可解析 ----------
  const date = postDate(post)
  if (data.date !== undefined && date === null) {
    findings.push({
      level: 'error',
      file,
      message: `date 无法解析：${String(data.date)}（推荐 2026-10-24T22:49:28+08:00）`,
    })
  }

  /*
   * date 应当带时区。裸日期（`2026-10-24`）或纯时刻会被不同构建机按各自时区解读，
   * 这是「同一天发布，CI 上却差一天」的根因。
   *
   * **必须读文件里的原始字面量**，不能读 `data.date`：`gray-matter` 会把
   * `2026-10-19T04:09:28+08:00` 解析成 `Date` 对象（`typeof` 是 `object`），
   * 于是「有没有写时区」这个信息在解析后就彻底消失了。
   * 早期按 `typeof data.date === 'string'` 判断，这段检查**从未执行过**。
   */
  const dateLiteral = rawScalarValue(post.raw, 'date')
  if (dateLiteral !== undefined && dateLiteral !== '') {
    const hasTime = /T\d{2}:\d{2}/.test(dateLiteral)
    const hasOffset = /(?:Z|[+-]\d{2}:\d{2})$/.test(dateLiteral)
    if (!hasTime || !hasOffset) {
      findings.push({
        level: 'warn',
        file,
        message: `date 建议写成带时区的完整格式：${dateLiteral} → 2026-10-24T22:49:28+08:00`,
      })
    }
  }

  // ---------- tags 类型 ----------
  if (data.tags !== undefined && !Array.isArray(data.tags)) {
    findings.push({
      level: 'error',
      file,
      message: `tags 应为数组，实际是 ${typeOfValue(data.tags)}`,
    })
  } else if (Array.isArray(data.tags)) {
    const nonString = data.tags.filter((tag) => typeof tag !== 'string')
    if (nonString.length > 0) {
      findings.push({ level: 'error', file, message: 'tags 里含非字符串项' })
    }
    const blankTags = (data.tags as unknown[]).filter(
      (tag) => typeof tag === 'string' && tag.trim() === '',
    )
    if (blankTags.length > 0) {
      findings.push({ level: 'warn', file, message: 'tags 里有空标签' })
    }
    const seen = new Set<string>()
    for (const tag of data.tags as string[]) {
      if (seen.has(tag)) {
        findings.push({ level: 'warn', file, message: `标签重复：${tag}` })
      }
      seen.add(tag)
    }
  }

  // ---------- 布尔字段 ----------
  for (const key of ['draft', 'outline'] as const) {
    const value = data[key]
    if (value !== undefined && typeof value !== 'boolean') {
      findings.push({
        level: 'warn',
        file,
        message: `${key} 应为 true/false，实际是 ${typeOfValue(value)}（字符串 "true" 不生效）`,
      })
    }
  }

  // ---------- 可选字段是否补齐 ----------
  for (const key of ['tags', 'description', 'draft', 'outline'] as const) {
    if (data[key] === undefined) {
      findings.push({ level: 'warn', file, message: `未写可选字段 ${key}（pnpm fix 可补齐）` })
    }
  }

  // ---------- deprecated / unknown ----------
  for (const { key, hint } of findDeprecatedKeys(data)) {
    findings.push({ level: 'warn', file, message: `使用了废弃字段 ${key}：${hint}` })
  }
  for (const key of findUnknownKeys(data)) {
    findings.push({ level: 'warn', file, message: `未知字段 ${key}（可能是拼写错误）` })
  }

  // ---------- 字段顺序 ----------
  if (!isCanonicalKeyOrder(Object.keys(data))) {
    findings.push({
      level: 'warn',
      file,
      message: 'frontmatter 字段顺序不符合规范（pnpm fix 可重排）',
    })
  }

  // ---------- 路径约定 ----------
  if (!post.path.compliant) {
    findings.push({
      level: 'warn',
      file,
      message: `目录不符合 年/月/日/序号/标题 约定：${post.path.deviation ?? ''}`,
    })
  }

  // ---------- 目录日期 vs frontmatter 日期 ----------
  if (post.path.compliant && postDate(post)) {
    // 用站点时区的日期比较，不能用 UTC（见 lib/dates.ts 的 isoDateInZone）
    const dirDate = `${post.path.year}${post.path.month}${post.path.day}`
    const frontDate = isoDateInZone(postDate(post)!, SITE_TIME_ZONE).replace(/-/g, '')
    if (dirDate !== frontDate) {
      findings.push({
        level: 'warn',
        file,
        message: `目录日期 ${dirDate} 与 date ${frontDate} 不一致（目录只是给人看的，但容易误读）`,
      })
    }
  }

  // ---------- slug 规范 ----------
  if (post.path.slug) {
    if (/\s/.test(post.path.slug)) {
      findings.push({ level: 'warn', file, message: `目录名含空格：${post.path.slug}` })
    }
    if (/[[\]]/.test(post.path.slug)) {
      findings.push({
        level: 'warn',
        file,
        message: `目录名含方括号（会被当成动态路由）：${post.path.slug}`,
      })
    }
  }

  // ---------- 正文 ----------
  if (post.body.trim() === '') {
    findings.push({ level: 'warn', file, message: '正文为空' })
  }
  // 正文里的 H1 会与 frontmatter 的 title 重复（WRITING.md 明确禁止）
  // 必须剔除代码块后再找：代码注释里的 `#` 不是 Markdown 标题
  if (/^#\s+\S/m.test(stripCodeBlocks(post.body))) {
    findings.push({
      level: 'warn',
      file,
      message: '正文里有 H1 标题（会与 frontmatter 的 title 重复）',
    })
  }
}

/** 主流程。 */
export default function main(argv: string[]): void {
  const args = parseArgs(argv, [...SPECS])
  if (wantsHelp(args)) {
    printHelp()
    return
  }

  const localeOption = optionValue(args, 'lang')
  const locale = localeOption === undefined ? undefined : parseLocale(localeOption)
  const strict = hasOption(args, 'strict')

  const posts = collectPostFiles(locale, { includeUndated: hasOption(args, 'all') })
  const findings: Finding[] = []

  for (const post of posts) checkPost(post, findings)

  const errors = findings.filter((finding) => finding.level === 'error')
  const warnings = findings.filter((finding) => finding.level === 'warn')

  blank()

  if (findings.length === 0) {
    success(`全部合规：${posts.length} 篇文章`)
    blank()
    return
  }

  // 按文件分组打印，便于逐个处理
  const byFile = new Map<string, Finding[]>()
  for (const finding of findings) {
    const list = byFile.get(finding.file)
    if (list) list.push(finding)
    else byFile.set(finding.file, [finding])
  }

  for (const [file, fileFindings] of byFile) {
    const relative = file
    console.log(c.bold(relative))
    for (const finding of fileFindings) {
      const mark = finding.level === 'error' ? c.red('error') : c.yellow('warn ')
      info(`  ${mark}  ${finding.message}`)
    }
    blank()
  }

  const summaryParts: string[] = []
  if (errors.length > 0) summaryParts.push(c.red(`${errors.length} 个错误`))
  if (warnings.length > 0) summaryParts.push(c.yellow(`${warnings.length} 个警告`))

  console.log(`${c.dim('检查了')} ${posts.length} ${c.dim('篇文章：')}${summaryParts.join('，')}`)

  if (warnings.length > 0 && errors.length === 0) {
    info(c.dim('可执行 pnpm fix 自动修复能修的项'))
  }
  blank()

  if (errors.length > 0 || (strict && warnings.length > 0)) {
    process.exitCode = 1
  }
}
