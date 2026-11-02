/**
 * 文章路径解析：`docs/<YYYYMM>/<DDNN>/<lang>/index.md`。
 *
 * 这是命令行侧对「一篇文章在哪」的唯一理解，`new` / `posts` / `check` / `fix`
 * 全部走这里。判定不自己写正则，而是复用 `.vitepress/support/article-path.ts`
 * 的 `parseArticlePath` —— 构建期的 `rewrites`、列表页、RSS 也用它，规则必须同源。
 *
 * 重构后的布局是「日期优先 + 语言内嵌」：
 *
 * ```text
 * docs/<YYYYMM>/<DDNN>/<lang>/index.md     文章（一篇文章 = 一个 <YYYYMM>/<DDNN> 目录）
 * docs/<YYYYMM>/<DDNN>/shared/{images,...} 跨语言共享资源（只放资源，不放 .md）
 * docs/site/<lang>/...                     站点页面（首页、about、posts、tags）
 * ```
 *
 * 因此命令行扫文章不能再「按语言目录遍历」：语言是文章路径的第 3 段，
 * 扫描必须从 `docs/` 全量开始，再按 `isArticlePath` / locale / date 逐层过滤。
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import matter from 'gray-matter'

import { asLocale, LOCALE_CODES } from '../../.vitepress/data/site'
import {
  articleUrlPath,
  isArticlePath,
  localeOfDocPath,
  parseArticlePath,
} from '../../.vitepress/support/article-path'
import { parseDate } from '../../.vitepress/support/format'
import { slugOf } from '../../.vitepress/support/slug'
import type { LocaleCode } from '../../.vitepress/types'
import { collectMarkdownFiles, DOCS_DIR, isDirectory, relativePathToUrl } from './site'

/** 一篇文章的目录身份：`<YYYYMM>/<DDNN>/<lang>/index.md`。 */
export interface PostPathInfo {
  /** 相对 `docs/` 的源文件路径，`/` 分隔。 */
  filePath: string
  /** 绝对路径。 */
  absolutePath: string
  /** 所属语言（文章看第 3 段目录，其它页面回退首段）。 */
  locale: LocaleCode
  /** 文章目录 `<YYYYMM>/<DDNN>`；不符合约定时为空串。 */
  articleDir: string
  /**
   * 站点路径（**未编码**，供终端展示）：`/zh-cn/202610/1901/你好，世界/`。
   * 不符合文章约定时退回源文件路径的通用换算，至少能看出文件在哪。
   */
  url: string
  /** 年月目录，如 `202610`。 */
  month: string
  /** 日 + 序号目录，如 `1901`。 */
  daySeq: string
  /** 两位「日」，如 `19`。 */
  day: string
  /** 两位「当日序号」，如 `01`。 */
  sequence: string
  /** 跨语言配对键：`<YYYYMM>/<DDNN>`，如 `202610/1901`（由父目录天然决定）。 */
  key: string
  /** 目录日期 `YYYYMMDD`（如 `20261019`），用于和 frontmatter 的 `date` 对比。 */
  dateKey: string
  /** URL 段落（frontmatter 的 `slug`，缺失时由 `title` 推导）。 */
  slug: string
  /** 是否符合 `<YYYYMM>/<DDNN>/<lang>/index.md` 约定。 */
  compliant: boolean
  /** 不符合约定时的原因，便于 `check` 给出可操作的提示。 */
  deviation?: string
}

/** 一份已解析的文章（含 frontmatter 与正文）。 */
export interface PostFile {
  path: PostPathInfo
  /** frontmatter 原始键值。 */
  data: Record<string, unknown>
  /** 正文（不含 frontmatter）。 */
  body: string
  /** 整个文件的原始文本。 */
  raw: string
}

/** 一篇「看起来想当文章、却不在文章目录」的文件。 */
export interface MisplacedDatedFile {
  /** 相对 `docs/` 的路径，`/` 分隔。 */
  filePath: string
}

/**
 * 一个文章目录（`<YYYYMM>/<DDNN>`）的扫描结果。
 *
 * `check` 的目录级规则全部基于它：目录少了语言层、语言目录缺 index.md、
 * 混进未知子目录、shared 里放了 Markdown、语言根直接堆文件……
 * 这些都不是「某篇文章」的问题，而是**目录本身**的问题，所以集中在这里扫一次。
 */
export interface ArticleDirScan {
  /** 年月目录，如 `202610`。 */
  month: string
  /** 日 + 序号目录，如 `1901`。 */
  daySeq: string
  /** 已有 `index.md` 的语言（即该目录下真实存在的语言版本）。 */
  locales: Set<LocaleCode>
  /** 语言子目录存在、但缺少 `index.md` 的语言（半成品翻译）。 */
  missingIndex: LocaleCode[]
  /** 是否存在 `shared/`（跨语言共享资源目录）。 */
  hasShared: boolean
  /** `<DDNN>` 下不是语言代码、也不是 `shared` 的子目录名。 */
  unknownDirs: string[]
  /** `<DDNN>/index.md` 是否存在（漏掉了语言层，旧习惯残留）。 */
  hasRootIndex: boolean
  /** `shared/` 下（递归）的 Markdown 文件，相对 `docs/` 的路径。 */
  sharedMarkdownFiles: string[]
  /** 语言子目录根直接放的非 `index.md` 文件，相对 `docs/` 的路径。 */
  strayFiles: string[]
}

/** 文章目录的规范示例，供各处提示复用（避免文案各写一份）。 */
export const ARTICLE_PATH_EXAMPLE = '202610/1901/zh-cn/index.md'

/** 列出目录下的子目录名；目录不存在时返回空数组（不抛错）。 */
function subdirectoryNames(dir: string): string[] {
  if (!isDirectory(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted()
}

/** 列出目录下的文件名；目录不存在时返回空数组（不抛错）。 */
function fileNames(dir: string): string[] {
  if (!isDirectory(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .toSorted()
}

/** 某个文章目录里「已经有 index.md」的语言。 */
function localeVersionsOf(articleDirPath: string): LocaleCode[] {
  return LOCALE_CODES.filter((code) => fileNames(join(articleDirPath, code)).includes('index.md'))
}

/**
 * 某个文章目录已有哪些语言版本（`new` 用它判断「是不是补翻译」）。
 *
 * 只看 `index.md` 是否存在：光有 `en/` 空目录不算翻译已存在，
 * 否则作者建了目录还没写文件时会被误判成「该语言已存在」。
 */
export function articleDirLocales(
  month: string,
  daySeq: string,
  docsDir: string = DOCS_DIR,
): LocaleCode[] {
  return localeVersionsOf(join(docsDir, month, daySeq))
}

/**
 * 解析文章路径。
 *
 * 不符合 `<YYYYMM>/<DDNN>/<lang>/index.md` 时**不抛错**，而是标记
 * `compliant: false` 并给出原因：`check` 要拿它报「目录不符合约定」，
 * 而目录里可能还躺着迁移前的旧路径文件——报错会中断整个检查，反而看不到完整清单。
 *
 * `data` 用来取 slug：文章 URL 由「目录 + slug」拼成，光有路径算不出来。
 * 不传 `data` 时 slug 走 `slugOf({})`（即 `untitled`），只有展示用途。
 */
export function parsePostPath(
  filePath: string,
  data: Record<string, unknown> = {},
  docsDir: string = DOCS_DIR,
): PostPathInfo {
  const slug = slugOf(data)
  const parts = parseArticlePath(filePath)
  const locale = localeOfDocPath(filePath)

  const base: PostPathInfo = {
    filePath,
    absolutePath: join(docsDir, filePath),
    locale,
    articleDir: '',
    url: relativePathToUrl(filePath),
    month: '',
    daySeq: '',
    day: '',
    sequence: '',
    key: '',
    dateKey: '',
    slug,
    compliant: false,
  }

  if (!parts) {
    return {
      ...base,
      deviation: `路径为 ${filePath}，应为 <YYYYMM>/<DDNN>/<lang>/index.md（如 ${ARTICLE_PATH_EXAMPLE}）`,
    }
  }

  return {
    ...base,
    locale: parts.locale,
    articleDir: `${parts.month}/${parts.daySeq}`,
    url: articleUrlPath(parts.locale, parts.month, parts.daySeq, slug),
    month: parts.month,
    daySeq: parts.daySeq,
    day: parts.day,
    sequence: parts.sequence,
    key: parts.key,
    dateKey: parts.dateKey,
    compliant: true,
  }
}

/** 读取并解析一份文章。语言由路径决定，不再需要调用方传。 */
export function readPostFile(filePath: string, docsDir: string = DOCS_DIR): PostFile {
  const raw = readFileSync(join(docsDir, filePath), 'utf-8')
  const { data, content } = matter(raw)
  const record = data as Record<string, unknown>

  return {
    path: parsePostPath(filePath, record, docsDir),
    data: record,
    body: content,
    raw,
  }
}

/** 递归收集 `docs/` 下全部 Markdown（相对 `docs/` 的路径，字典序保证输出稳定）。 */
function allMarkdownFiles(docsDir: string): string[] {
  return collectMarkdownFiles(docsDir, docsDir).toSorted()
}

/**
 * 收集某语言（或全部语言）下的文章文件。
 *
 * 布局改成日期优先后，语言不再是目录树的第一层，因此这里从 `docs/` 全量扫描，
 * 再用 `isArticlePath`（与构建期 `support/content.ts` 的 `isPost()` 同源）过滤。
 * `includeUndated: true` 时也返回缺 `date` 的文件，仅供 `check` 报告
 * 「文章目录里没有 date」，正常列举不该带上它。
 */
export function collectPostFiles(
  locale?: LocaleCode,
  options: { includeUndated?: boolean; docsDir?: string } = {},
): PostFile[] {
  const docsDir = options.docsDir ?? DOCS_DIR

  const files: PostFile[] = []
  for (const filePath of allMarkdownFiles(docsDir)) {
    if (!isArticlePath(filePath)) continue

    const post = readPostFile(filePath, docsDir)
    if (locale && post.path.locale !== locale) continue
    if (!options.includeUndated && parseDate(post.data.date) === null) continue
    files.push(post)
  }

  return files
}

/**
 * 找到文件路径里代表语言的那一段。
 *
 * 新布局里语言是第 3 段（`202610/1901/en/index.md`），旧布局残留里是第 1 段
 * （`en/2026/10/19/01/index.md`）。这里按「任意一段是语言代码」取第一个命中，
 * 都命中不了再退回 `asLocale(首段)`，保证 `--lang` 过滤不会把旧文件漏掉。
 */
function localeSegmentOf(filePath: string): LocaleCode {
  for (const segment of filePath.split('/')) {
    if ((LOCALE_CODES as readonly string[]).includes(segment)) return segment as LocaleCode
  }
  return asLocale(filePath.split('/')[0])
}

/**
 * 扫描「有 `date`、却不在文章目录」的 Markdown。
 *
 * 文章位置是严格判定的：带日期但放在别处（旧布局的 `<lang>/<YYYYMM>/...`、
 * 站点页面目录、文章目录里忘了叫 `index.md`）的文件会被当作普通页面静默渲染，
 * 不会进文章列表。`check` 用这份清单提示，否则「文章没出现」很难排查。
 *
 * 两类位置有意排除：
 * - `site/`（首段）：站点页面（首页、about、posts、tags），本来就不是文章；
 * - `shared/`（任意段）：跨语言资源目录，只放资源。
 */
export function collectMisplacedDatedFiles(
  locale?: LocaleCode,
  options: { docsDir?: string } = {},
): MisplacedDatedFile[] {
  const docsDir = options.docsDir ?? DOCS_DIR

  const found: MisplacedDatedFile[] = []
  for (const filePath of allMarkdownFiles(docsDir)) {
    if (isArticlePath(filePath)) continue

    const segments = filePath.split('/')
    if (segments[0] === 'site') continue
    if (segments.includes('shared')) continue

    if (locale && localeSegmentOf(filePath) !== locale) continue

    const { data } = matter(readFileSync(join(docsDir, filePath), 'utf-8'))
    if (parseDate((data as Record<string, unknown>).date) === null) continue
    found.push({ filePath })
  }

  return found
}

/** 文章的实际日期（frontmatter），无法解析时返回 null。 */
export function postDate(post: PostFile): Date | null {
  return parseDate(post.data.date)
}

/**
 * 某天已占用的序号（`01`、`02`…）。
 *
 * 序号现在是**全天全局**的：`docs/<YYYYMM>/<DDNN>` 目录由两种语言共享，
 * `1901/zh-cn` 与 `1901/en` 是同一篇文章的两个版本，不能各算一号。
 * 因此不再按语言过滤——目录存在即占用。
 *
 * 扫的是**目录名**而不是 frontmatter：空目录 / 刚建好还没写 `date` 的目录
 * 同样占着号，按 frontmatter 算会把已经存在的目录覆盖掉。
 * 目录名形如 `<day><NN>`（`1901`），返回后两位。
 */
export function usedSequences(month: string, day: string, docsDir: string = DOCS_DIR): Set<string> {
  // 只认当天的目录：`2001` 属于 20 日，不能干扰 19 日的序号分配
  const dayPattern = new RegExp(`^${day}\\d{2}$`)
  return new Set(
    subdirectoryNames(join(docsDir, month))
      .filter((name) => dayPattern.test(name))
      .map((name) => name.slice(2)),
  )
}

/** 列出某月已有的文章目录名（`1901`、`2601`），用于提示「这个月有几篇」。 */
export function articleDirsOfMonth(month: string, docsDir: string = DOCS_DIR): string[] {
  return subdirectoryNames(join(docsDir, month)).filter((name) => /^\d{4}$/.test(name))
}

/**
 * 扫描文章目录，供 `check` 的目录级规则使用。
 *
 * @param month   只扫某个月（`202610`）；省略则扫 `docs/` 下全部 6 位年月目录。
 * @param docsDir 内容根目录，可传入其它目录做临时验证。
 */
export function scanArticleDirs(month?: string, docsDir: string = DOCS_DIR): ArticleDirScan[] {
  /*
   * 只看 6 位纯数字的月目录：`docs/site` 之类的顶层目录不是日期树。
   * 月份 / 日 / 序号是否越界不在这里过滤——越界目录同样是「作者写错了」，
   * 要留给 `check` 报告，而不是静默跳过。
   */
  const months = month ? [month] : subdirectoryNames(docsDir).filter((name) => /^\d{6}$/.test(name))

  const scanned: ArticleDirScan[] = []
  for (const monthName of months) {
    for (const daySeq of articleDirsOfMonth(monthName, docsDir)) {
      const articleDirPath = join(docsDir, monthName, daySeq)
      const rootFiles = fileNames(articleDirPath)
      const locales = new Set<LocaleCode>()
      const missingIndex: LocaleCode[] = []
      const unknownDirs: string[] = []
      const strayFiles: string[] = []
      let hasShared = false

      for (const name of subdirectoryNames(articleDirPath)) {
        if ((LOCALE_CODES as readonly string[]).includes(name)) {
          const code = name as LocaleCode
          const languageFiles = fileNames(join(articleDirPath, code))
          if (languageFiles.includes('index.md')) {
            locales.add(code)
          } else {
            missingIndex.push(code)
          }
          // 语言根只应有 index.md；images/ 等类型目录是目录，不算
          for (const fileName of languageFiles) {
            if (fileName === 'index.md') continue
            strayFiles.push(`${monthName}/${daySeq}/${code}/${fileName}`)
          }
        } else if (name === 'shared') {
          hasShared = true
        } else {
          unknownDirs.push(name)
        }
      }

      scanned.push({
        month: monthName,
        daySeq,
        locales,
        missingIndex,
        hasShared,
        unknownDirs,
        hasRootIndex: rootFiles.includes('index.md'),
        sharedMarkdownFiles: hasShared
          ? collectMarkdownFiles(join(articleDirPath, 'shared'), docsDir).toSorted()
          : [],
        strayFiles,
      })
    }
  }

  return scanned
}
