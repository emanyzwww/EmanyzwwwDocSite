/**
 * `pnpm doc check` —— 检查元字段、目录结构与内容规范。
 *
 * 只检查、不修改；可修的问题交给 `pnpm doc fix`。检查范围受全局参数
 * `-l/-d/-t` 限制，但**目录级检查始终全量**（一个目录坏没坏，与这次看哪种语言无关）。
 *
 * 退出码：有 error 时为 1（可直接当门禁）；只有 warn 时为 0。
 */

import { isMeaningfulUpdate, parseDate } from '../../.vitepress/support/format'
import { isUsableSlug } from '../../.vitepress/support/slug'
import {
  parseCommandArgs,
  parseScope,
  printCommandHelp,
  tagFilterOf,
  wantsCommandHelp,
  type CommandMeta,
} from '../lib/cli'
import { isoDateInZone } from '../lib/dates'
import { matchesScope, type Scope } from '../lib/filters'
import {
  findDeprecatedKeys,
  findUnknownKeys,
  isCanonicalKeyOrder,
  rawScalarValue,
  typeOfValue,
  unquotedStringFields,
} from '../lib/frontmatter'
import { REQUIRED_FRONTMATTER_KEYS } from '../lib/frontmatter-schema'
import {
  ARTICLE_PATH_EXAMPLE,
  collectMisplacedDatedFiles,
  collectPostFiles,
  postDate,
  scanArticleDirs,
} from '../lib/posts'
import type { ArticleDirScan, PostFile } from '../lib/posts'
import { askConfirm } from '../lib/prompt'
import { LOCALE_CODES, SITE_TIME_ZONE } from '../lib/site'
import { blank, c, info, success } from '../lib/ui'
import fixMain from './fix'
import formatMain from './format'

/** 帮助信息。 */
export const meta: CommandMeta = {
  name: 'check',
  summary: '检查元字段、目录结构与内容规范',
  usage: 'check [参数]',
  options: [],
  examples: ['pnpm doc check', 'pnpm doc check -l=zh-cn,en', 'pnpm doc check -d=2026'],
}

/** 一条检查结果。 */
interface Finding {
  level: 'error' | 'warn'
  file: string
  message: string
}

/** 检查结果统计。 */
interface CheckOutcome {
  errors: number
  warnings: number
  posts: number
  dirs: number
}

/**
 * 去掉代码块与行内代码，返回「真正的正文」。
 *
 * 代码注释里的 `#` 不是 Markdown 标题；不剔除会误报「正文里有 H1」。
 */
function stripCodeBlocks(markdown: string): string {
  return markdown
    .replace(/^(\s*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\2\s*$/gm, '')
    .replace(/^(\s*)(`{3,}|~{3,})[^\n]*\n[\s\S]*$/m, '')
    .replace(/`[^`\n]*`/g, '')
}

/** 检查一篇文章的 frontmatter 与正文。 */
function checkPost(post: PostFile, findings: Finding[]): void {
  const file = post.path.filePath
  const data = post.data

  // ---------- TOML 风格的分隔符（只给专门提示，后面还会报缺字段） ----------
  if (post.raw.startsWith('+++')) {
    findings.push({
      level: 'warn',
      file,
      message: '检测到 `+++` 分隔符：本站只支持 YAML 的 `---`，TOML 的 `+++` 不会被解析',
    })
  }

  // ---------- 必填字段 ----------
  for (const key of REQUIRED_FRONTMATTER_KEYS) {
    const value = data[key]
    if (value === undefined || value === null || value === '') {
      findings.push({ level: 'error', file, message: `缺少必填字段 ${key}` })
    }
  }

  // ---------- title 类型（空值已由必填字段覆盖） ----------
  if (data.title !== undefined && typeof data.title !== 'string') {
    findings.push({
      level: 'error',
      file,
      message: `title 应为字符串，实际是 ${typeOfValue(data.title)}`,
    })
  }

  // ---------- date 可解析且带时区 ----------
  const date = postDate(post)
  if (data.date !== undefined && date === null) {
    findings.push({
      level: 'error',
      file,
      message: `date 无法解析：${String(data.date)}（推荐 2026-10-24T22:49:28+08:00）`,
    })
  }

  /*
   * 必须读文件里的原始字面量：`gray-matter` 会把带时区的时间戳解析成 Date，
   * 「有没有写时区」这个信息在解析后就消失了。
   */
  const dateLiteral = rawScalarValue(post.raw, 'date')
  if (dateLiteral !== undefined && dateLiteral !== '') {
    const hasTime = /T\d{2}:\d{2}/.test(dateLiteral)
    const hasOffset = /(?:Z|[+-]\d{2}:\d{2})$/.test(dateLiteral)
    if (!hasTime || !hasOffset) {
      findings.push({
        level: 'warn',
        file,
        message: `date 建议写成带时区的完整格式：${dateLiteral} → 如 2026-10-24T22:49:28+08:00`,
      })
    }
  }

  // ---------- updated ----------
  if (data.updated !== undefined && data.updated !== null && data.updated !== '') {
    const updatedDate = parseDate(data.updated)
    if (updatedDate === null) {
      findings.push({
        level: 'error',
        file,
        message: `updated 无法解析：${String(data.updated)}（格式同 date）`,
      })
    } else if (date !== null && !isMeaningfulUpdate(date, updatedDate, SITE_TIME_ZONE)) {
      findings.push({
        level: 'warn',
        file,
        message: 'updated 与 date 同一天或更早，文章页不会显示「更新于」',
      })
    }

    // 与 date 同一口径：必须读原始字面量才能看出「有没有写时区」
    const updatedLiteral = rawScalarValue(post.raw, 'updated')
    if (updatedLiteral !== undefined && updatedLiteral !== '') {
      const hasTime = /T\d{2}:\d{2}/.test(updatedLiteral)
      const hasOffset = /(?:Z|[+-]\d{2}:\d{2})$/.test(updatedLiteral)
      if (!hasTime || !hasOffset) {
        findings.push({
          level: 'warn',
          file,
          message: `updated 建议写成带时区的完整格式：${updatedLiteral} → 如 2026-10-28T09:00:00+08:00`,
        })
      }
    }
  }

  // ---------- tags ----------
  if (data.tags !== undefined && !Array.isArray(data.tags)) {
    findings.push({
      level: 'error',
      file,
      message: `tags 应为数组，实际是 ${typeOfValue(data.tags)}`,
    })
  } else if (Array.isArray(data.tags)) {
    if (data.tags.some((tag) => typeof tag !== 'string')) {
      findings.push({ level: 'error', file, message: 'tags 里含非字符串项' })
    }
    if (data.tags.some((tag) => typeof tag === 'string' && tag.trim() === '')) {
      findings.push({ level: 'warn', file, message: 'tags 里有空标签' })
    }
    const seen = new Set<string>()
    for (const tag of data.tags as string[]) {
      if (seen.has(tag)) findings.push({ level: 'warn', file, message: `标签重复：${tag}` })
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
      findings.push({ level: 'warn', file, message: `未写可选字段 ${key}（doc fix 可补齐）` })
    }
  }

  // ---------- 废弃 / 未知字段 ----------
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
      message: 'frontmatter 字段顺序不符合规范（doc fix 可重排）',
    })
  }

  // ---------- 字符串字段引号 ----------
  const unquoted = unquotedStringFields(post.raw)
  if (unquoted.length > 0) {
    findings.push({
      level: 'warn',
      file,
      message: `${unquoted.join('、')} 未加引号（doc fix 可规范化）`,
    })
  }

  // ---------- 路径约定 ----------
  if (!post.path.compliant) {
    findings.push({
      level: 'warn',
      file,
      message: `目录不符合 <YYYYMM>/<DDNN>/<lang>/index.md 约定：${post.path.deviation ?? ''}`,
    })
  }

  // ---------- 目录日期 vs frontmatter 日期 ----------
  if (post.path.compliant && date) {
    const dirDate = post.path.dateKey
    const frontDate = isoDateInZone(date, SITE_TIME_ZONE).replace(/-/g, '')
    if (dirDate !== frontDate) {
      findings.push({
        level: 'warn',
        file,
        message: `目录日期 ${dirDate} 与 date ${frontDate} 不一致（目录只是给人看的，但容易误读）`,
      })
    }
  }

  // ---------- slug ----------
  if (data.slug === undefined || data.slug === '') {
    findings.push({ level: 'warn', file, message: '未写 slug（doc fix 可自动按 title 补齐）' })
  } else if (typeof data.slug !== 'string') {
    findings.push({
      level: 'warn',
      file,
      message: `slug 应为字符串，实际是 ${typeOfValue(data.slug)}`,
    })
  } else if (!isUsableSlug(data.slug)) {
    findings.push({
      level: 'warn',
      file,
      message: `slug 不可用：${data.slug}（不能含空格、斜杠、方括号等会破坏 URL 的字符）`,
    })
  }

  // ---------- 正文 ----------
  if (post.body.trim() === '') {
    findings.push({ level: 'warn', file, message: '正文为空' })
  }
  const prose = stripCodeBlocks(post.body)
  if (/^#\s+\S/m.test(prose)) {
    findings.push({
      level: 'warn',
      file,
      message: '正文里有 H1 标题（会与 frontmatter 的 title 重复）',
    })
  }

  checkCustomSyntax(prose, file, findings)
}

/**
 * 检查自定义语法的用法：独占一段的裸 GitHub 链接不会自动变卡，
 * 要卡片得写 `:::github owner/repo`。
 */
function checkCustomSyntax(prose: string, file: string, findings: Finding[]): void {
  const lines = prose.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] ?? '').trim()
    if (!/^<?https?:\/\/github\.com\/[^/\s]+\/[^/\s]+>?\/?$/.test(line)) continue
    const prev = (lines[index - 1] ?? '').trim()
    const next = (lines[index + 1] ?? '').trim()
    if (prev !== '' || next !== '') continue

    findings.push({
      level: 'warn',
      file,
      message:
        `正文（已剔除代码块）第 ${index + 1} 行是独占一段的裸 GitHub 链接（不会自动变卡）。` +
        '要卡片请写成：:::github owner/repo',
    })
  }
}

/** 目录级检查：一篇文章 = 一个 `<YYYYMM>/<DDNN>` 目录。 */
function checkArticleDirs(dirs: readonly ArticleDirScan[], findings: Finding[]): void {
  for (const dir of dirs) {
    const where = `${dir.month}/${dir.daySeq}`

    const monthNumber = Number(dir.month.slice(4))
    const dayNumber = Number(dir.daySeq.slice(0, 2))
    const sequenceNumber = Number(dir.daySeq.slice(2))
    if (monthNumber < 1 || monthNumber > 12) {
      findings.push({
        level: 'warn',
        file: where,
        message: `年月目录 ${dir.month} 的月份不合法：${dir.month.slice(4)}（应为 01–12）`,
      })
    }
    if (dayNumber < 1 || dayNumber > 31) {
      findings.push({
        level: 'warn',
        file: where,
        message: `日序号目录 ${dir.daySeq} 的「日」不合法：${dir.daySeq.slice(0, 2)}（应为 01–31）`,
      })
    }
    if (sequenceNumber < 1 || sequenceNumber > 99) {
      findings.push({
        level: 'warn',
        file: where,
        message: `日序号目录 ${dir.daySeq} 的「当日序号」不合法：${dir.daySeq.slice(2)}（应为 01–99）`,
      })
    }

    if (dir.hasRootIndex) {
      findings.push({
        level: 'warn',
        file: where,
        message:
          `文章目录根直接放了 index.md（缺少语言层）：应放到 <YYYYMM>/<DDNN>/<lang>/index.md，` +
          `如 ${ARTICLE_PATH_EXAMPLE}`,
      })
    }

    if (dir.locales.size === 0) {
      findings.push({
        level: 'warn',
        file: where,
        message:
          '没有任何语言版本的 index.md（zh-cn/en 都缺），这篇文章不会被构建：' +
          `至少写一个 ${LOCALE_CODES.join('/')} 下的 index.md`,
      })
    } else {
      for (const code of dir.missingIndex) {
        findings.push({
          level: 'warn',
          file: `${where}/${code}`,
          message:
            '语言目录存在但缺 index.md（翻译没写完，或空目录该删掉）：' +
            `补写用 pnpm doc new -l=${code} --into ${where}`,
        })
      }
    }

    for (const name of dir.unknownDirs) {
      findings.push({
        level: 'warn',
        file: `${where}/${name}`,
        message: `未知子目录「${name}」：<YYYYMM>/<DDNN> 下只应有 ${LOCALE_CODES.join('、')} 与 shared`,
      })
    }

    for (const file of dir.sharedMarkdownFiles) {
      findings.push({
        level: 'warn',
        file,
        message:
          'shared/ 只放资源、不放 Markdown：文章应写成 <YYYYMM>/<DDNN>/<lang>/index.md，' +
          '资源引用用 ../shared/images/xx.png',
      })
    }

    for (const file of dir.strayFiles) {
      findings.push({
        level: 'warn',
        file,
        message:
          '语言目录根只应有 index.md：其它文件请放进类型目录（images/、audio/、video/、files/），' +
          '共享资源放 ../shared/',
      })
    }
  }
}

/** 执行检查并打印，返回统计。 */
function runCheck(scope: Scope): CheckOutcome {
  const posts = collectPostFiles(undefined, { includeUndated: true }).filter((post) =>
    matchesScope(post, scope),
  )

  const misplaced = scope.locales
    ? [
        ...new Set(
          scope.locales.flatMap((locale) =>
            collectMisplacedDatedFiles(locale).map((file) => file.filePath),
          ),
        ),
      ].map((filePath) => ({ filePath }))
    : collectMisplacedDatedFiles()

  // 目录级检查始终全量
  const articleDirs = scanArticleDirs()
  const findings: Finding[] = []

  for (const post of posts) checkPost(post, findings)
  checkArticleDirs(articleDirs, findings)

  for (const { filePath } of misplaced) {
    findings.push({
      level: 'warn',
      file: filePath,
      message:
        '有 date 但不在文章目录（不会进入文章列表）：应放到 <YYYYMM>/<DDNN>/<lang>/index.md，' +
        `例如 ${ARTICLE_PATH_EXAMPLE}`,
    })
  }

  const errors = findings.filter((finding) => finding.level === 'error')
  const warnings = findings.filter((finding) => finding.level === 'warn')

  blank()

  if (findings.length === 0) {
    success(`全部合规：${posts.length} 篇文章 / ${articleDirs.length} 个文章目录`)
    blank()
    return { errors: 0, warnings: 0, posts: posts.length, dirs: articleDirs.length }
  }

  const byFile = new Map<string, Finding[]>()
  for (const finding of findings) {
    const list = byFile.get(finding.file)
    if (list) list.push(finding)
    else byFile.set(finding.file, [finding])
  }

  for (const [file, fileFindings] of byFile) {
    console.log(c.bold(file))
    for (const finding of fileFindings) {
      const mark = finding.level === 'error' ? c.red('error') : c.yellow('warn ')
      info(`  ${mark}  ${finding.message}`)
    }
    blank()
  }

  const summaryParts: string[] = []
  if (errors.length > 0) summaryParts.push(c.red(`${errors.length} 个错误`))
  if (warnings.length > 0) summaryParts.push(c.yellow(`${warnings.length} 个警告`))
  console.log(
    `${c.dim('检查了')} ${posts.length} 篇文章、${articleDirs.length} 个文章目录` +
      `${misplaced.length > 0 ? `、${misplaced.length} 个位置异常文件` : ''}${c.dim('：')}` +
      summaryParts.join('，'),
  )

  if (errors.length === 0) {
    info(c.dim('可执行 pnpm doc fix 自动修复能修的项'))
  }
  blank()

  return {
    errors: errors.length,
    warnings: warnings.length,
    posts: posts.length,
    dirs: articleDirs.length,
  }
}

/** 命令入口。 */
export default async function main(argv: string[]): Promise<void> {
  const args = parseCommandArgs(argv, [])
  if (wantsCommandHelp(args)) {
    printCommandHelp(meta)
    return
  }

  const scope = parseScope(args)
  tagFilterOf(scope, 'check')
  const outcome = runCheck(scope)
  if (outcome.errors > 0) process.exitCode = 1
}

/** 供主菜单复用：检查完可以直接接着修/排版。 */
export async function interactive(): Promise<void> {
  const scope: Scope = { locales: undefined, date: undefined, tag: { mode: 'none' } }
  const outcome = runCheck(scope)
  if (outcome.errors === 0 && outcome.warnings === 0) return

  const shouldFix = await askConfirm('要自动修复可修项吗？', false)
  if (shouldFix) await fixMain([])

  const shouldFormat = await askConfirm('要格式化正文吗？', false)
  if (shouldFormat) await formatMain([])
}
