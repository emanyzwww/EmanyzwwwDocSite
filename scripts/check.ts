/**
 * `pnpm check` —— 检查内容与 frontmatter 是否合规。
 *
 * 只检查、不修改。可修的问题交给 `pnpm fix`。
 *
 * 检查项分成两级：
 * - **error**：会让内容出错或无法构建（缺 `title`、`date` 不可解析、标签不是数组）
 * - **warn**：能构建但不合规范（字段顺序乱、日期没带时区、目录日期与 frontmatter 不一致、
 *   用了废弃字段、slug 缺失或不可用、带 date 却不在文章目录）
 *
 * 文章位置是严格判定的：只有 `<YYYYMM>/<DDNN>/<lang>/index.md` 算文章，
 * 因此「旧布局残留 / 放错位置」不再逐个当文章检查，而是单独提示一次。
 *
 * 除了逐篇检查，还有一组**目录级**检查（见 `checkArticleDirs`）：一篇文章 =
 * 一个 `<YYYYMM>/<DDNN>` 目录，目录本身可能坏掉——少了语言层、语言目录缺
 * `index.md`、混进未知子目录、`shared/` 里放了 Markdown……这些都不是某篇文章
 * 的问题，逐篇检查发现不了。
 *
 * 退出码：有 error 时为 1（可直接接进 CI 门禁），只有 warn 时为 0。
 */

import { isMeaningfulUpdate, parseDate } from '../.vitepress/support/format'
import { isUsableSlug } from '../.vitepress/support/slug'
import { hasOption, optionValue, parseArgs, wantsHelp } from './lib/args'
import { isoDateInZone } from './lib/dates'
import {
  findDeprecatedKeys,
  findUnknownKeys,
  isCanonicalKeyOrder,
  rawScalarValue,
  typeOfValue,
} from './lib/frontmatter'
import { REQUIRED_FRONTMATTER_KEYS } from './lib/frontmatter-schema'
import {
  ARTICLE_PATH_EXAMPLE,
  collectMisplacedDatedFiles,
  collectPostFiles,
  postDate,
  scanArticleDirs,
} from './lib/posts'
import type { ArticleDirScan, PostFile } from './lib/posts'
import { LOCALE_CODES, parseLocale, SITE_TIME_ZONE } from './lib/site'
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

  // ---------- updated 可解析（可选字段） ----------
  /*
   * `updated` 只影响文章页是否显示「更新于」，写错不会让构建失败；
   * 但写错就等于**悄悄不显示**，所以这里按 error 报（作者能立刻发现）。
   * 与 `date` 同一天或更早则只给 warn：页面规则是「同日不算更新」。
   */
  if (data.updated !== undefined && data.updated !== null && data.updated !== '') {
    const updatedDate = parseDate(data.updated)
    if (updatedDate === null) {
      findings.push({
        level: 'error',
        file,
        message: `updated 无法解析：${String(data.updated)}（格式同 date，如 2026-10-28T09:00:00+08:00）`,
      })
    } else if (date !== null && !isMeaningfulUpdate(date, updatedDate, SITE_TIME_ZONE)) {
      findings.push({
        level: 'warn',
        file,
        message: 'updated 与 date 同一天或更早，文章页不会显示「更新于」',
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
      message: `目录不符合 <YYYYMM>/<DDNN>/<lang>/index.md 约定：${post.path.deviation ?? ''}`,
    })
  }

  // ---------- 目录日期 vs frontmatter 日期 ----------
  if (post.path.compliant && date) {
    // 用站点时区的日期比较，不能用 UTC（见 lib/dates.ts 的 isoDateInZone）
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
  /*
   * slug 现在是**纯 frontmatter 字段**（URL 段落），不再与目录名有关。
   * 缺失时构建期会按 title 推导，`fix` 也能补；显式写了但不可用（空格、
   * 斜杠、方括号…）则必须提示——它最终会进 URL，坏字符会让链接对不上。
   */
  if (data.slug === undefined) {
    findings.push({ level: 'warn', file, message: '未写 slug（pnpm fix 可自动按 title 补齐）' })
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
  // 正文里的 H1 会与 frontmatter 的 title 重复（WRITING.md 明确禁止）
  // 必须剔除代码块后再找：代码注释里的 `#` 不是 Markdown 标题
  const prose = stripCodeBlocks(post.body)
  if (/^#\s+\S/m.test(prose)) {
    findings.push({
      level: 'warn',
      file,
      message: '正文里有 H1 标题（会与 frontmatter 的 title 重复）',
    })
  }

  // ---------- 自定义语法 ----------
  checkCustomSyntax(prose, file, findings)
}

/**
 * 检查本站自定义语法的用法。
 *
 * ## 为什么需要这一项
 *
 * 块级指令（`:::github` 等）是**显式**语法：写对才生效，写错就报错。
 * 但有两种笔误是"能构建、看起来也正常"的，必须在这里抓：
 *
 * 1. **裸仓库链接**——旧版本会自动升级成卡片，现在不会了。作者沿用旧习惯
 *    直接粘 URL，得到的是一条普通链接，往往不会意识到需要写成 `:::github`。
 * 2. **指令名拼错**——`:::gihub` 会立刻报错（构建期就炸），所以这里只提示
 *    "看起来像指令但不是指令行"的情况，例如缩进出错导致的 `::: github`
 *    （`:::` 与名字之间有空格仍能解析，真正的问题是前缀有文字）。
 */
function checkCustomSyntax(prose: string, file: string, findings: Finding[]): void {
  // 独占一段的裸 GitHub 仓库链接：不会再自动变卡
  const lines = prose.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] ?? '').trim()
    if (!/^<?https?:\/\/github\.com\/[^/\s]+\/[^/\s]+>?\/?$/.test(line)) continue

    // 独段判定：前后都必须是空行或文件边界
    const prev = (lines[index - 1] ?? '').trim()
    const next = (lines[index + 1] ?? '').trim()
    if (prev !== '' || next !== '') continue

    findings.push({
      level: 'warn',
      file,
      message:
        `第 ${index + 1} 行是独占一段的裸 GitHub 链接，现在是普通链接（不会自动变卡）。` +
        '要卡片请写成：:::github owner/repo',
    })
  }
}

/**
 * 目录级检查：一篇文章 = 一个 `<YYYYMM>/<DDNN>` 目录。
 *
 * 为什么单独做：文章判定是严格的，目录坏掉时通常**根本没有文章**可以被逐篇检查
 * 命中——`202610/1901/zh-cn.md`（漏了语言层）、`1901/`（空目录）、
 * `1901/fr/index.md`（未知语言）都会静默地从文章列表里消失，作者只能看到
 * 「我写的文章不见了」。这里把「目录结构本身」的问题一次说清楚。
 *
 * 全部按 warn 报：它们不会让构建失败（顶多少几篇文章），但一定不合规范。
 */
function checkArticleDirs(dirs: readonly ArticleDirScan[], findings: Finding[]): void {
  for (const dir of dirs) {
    const where = `${dir.month}/${dir.daySeq}`

    // ---------- 数字越界的目录名 ----------
    /*
     * 目录名是纯数字时正则放行，但 `202613`（13 月）、`3201`（32 日）、
     * `1900`（第 00 篇）都会让「目录日期」与 frontmatter 的 date 永远对不上，
     * 排序也可能错位。逐字段报，作者一眼知道错在哪一段。
     */
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

    // ---------- 漏掉语言层 ----------
    if (dir.hasRootIndex) {
      findings.push({
        level: 'warn',
        file: where,
        message:
          `文章目录根直接放了 index.md（缺少语言层）：应放到 <YYYYMM>/<DDNN>/<lang>/index.md，` +
          `如 ${ARTICLE_PATH_EXAMPLE}`,
      })
    }

    // ---------- 语言版本 ----------
    if (dir.locales.size === 0) {
      /*
       * 没有任何 `<lang>/index.md`：这个目录不会被构建成任何页面。
       * 这里只报一条汇总，不再对每个 missingIndex 重复报——「都缺」时
       * 逐语言刷屏只会让作者更难看清主要问题。
       */
      findings.push({
        level: 'warn',
        file: where,
        message:
          '没有任何语言版本的 index.md（zh-cn/en 都缺），这篇文章不会被构建：' +
          `至少写一个 ${LOCALE_CODES.join('/')} 下的 index.md`,
      })
    } else {
      // 部分语言有版本、另一语言的目录建了却没写文件 = 翻译做了一半
      for (const code of dir.missingIndex) {
        findings.push({
          level: 'warn',
          file: `${where}/${code}`,
          message:
            '语言目录存在但缺 index.md（翻译没写完，或空目录该删掉）：' +
            `补写用 pnpm new -l=${code} --into ${where}`,
        })
      }
    }

    // ---------- 未知子目录 ----------
    for (const name of dir.unknownDirs) {
      findings.push({
        level: 'warn',
        file: `${where}/${name}`,
        message:
          `未知子目录「${name}」：<YYYYMM>/<DDNN> 下只应有 ` +
          `${LOCALE_CODES.join('、')} 与 shared`,
      })
    }

    // ---------- shared/ 里的 Markdown ----------
    /*
     * `shared/` 是**跨语言资源**目录。往里放 .md 会被当成普通页面构建
     * （或干脆不构建），两条路都不对；文章必须落在 `<lang>/index.md`。
     */ for (const file of dir.sharedMarkdownFiles) {
      findings.push({
        level: 'warn',
        file,
        message:
          'shared/ 只放资源、不放 Markdown：文章应写成 <YYYYMM>/<DDNN>/<lang>/index.md，' +
          '资源引用用 ../shared/images/xx.png',
      })
    }

    // ---------- 语言目录根直接放文件 ----------
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
  const misplaced = collectMisplacedDatedFiles(locale)
  /*
   * 目录级检查不受 --lang 影响：一个 `<YYYYMM>/<DDNN>` 目录本身好不好，
   * 与「这次只看哪种语言」无关。按语言裁剪反而会让目录问题在单语言检查里消失。
   */
  const articleDirs = scanArticleDirs()
  const findings: Finding[] = []

  for (const post of posts) checkPost(post, findings)
  checkArticleDirs(articleDirs, findings)

  /*
   * 「有 date 但不在文章目录」单独提示：它不会被当成文章（也不该被当成文章
   * 检查），但作者往往以为它已经发布了。一次汇总成一条，避免刷屏。
   */
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

  const scopeParts = [`${posts.length} 篇文章`, `${articleDirs.length} 个文章目录`]
  if (misplaced.length > 0) scopeParts.push(`${misplaced.length} 个位置异常文件`)
  const scope = scopeParts.join('、')
  console.log(`${c.dim('检查了')} ${scope}${c.dim('：')}${summaryParts.join('，')}`)

  if (warnings.length > 0 && errors.length === 0) {
    info(c.dim('可执行 pnpm fix 自动修复能修的项'))
  }
  blank()

  if (errors.length > 0 || (strict && warnings.length > 0)) {
    process.exitCode = 1
  }
}
