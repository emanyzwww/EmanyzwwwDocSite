/**
 * 文章路径解析：`docs/<lang>/posts/YYYY/MM/DD/NN/<slug>/index.md`。
 *
 * 这是命令行侧对「一篇文章在哪」的唯一理解，`new` / `posts` / `check` / `fix`
 * 全部走这里。它必须与 `.vitepress/support/content.ts` 的 `isPost()` 口径一致：
 * 「去掉语言前缀后位于 `posts/` 分区」才算文章——否则命令扫出了一堆
 * `about/index.md`、`tags/index.md`，统计和校验就全是噪声。
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import matter from 'gray-matter'

import { LOCALE_CODES } from '../../.vitepress/data/site'
import { parseDate } from '../../.vitepress/support/format'
import type { LocaleCode } from '../../.vitepress/types'
import { collectMarkdownFiles, DOCS_DIR, POST_SECTION, relativePathToUrl } from './site'

/** 文章目录的一层结构：年/月/日/序号/标题。 */
export interface PostPathInfo {
  /** 相对 `docs/` 的源文件路径，`/` 分隔。 */
  filePath: string
  /** 绝对路径。 */
  absolutePath: string
  /** 所属语言。 */
  locale: LocaleCode
  /** 站点路径（未编码），如 `/zh-cn/posts/2026/10/19/01/hello-world/`。 */
  url: string
  /** 年份目录，如 `2026`。 */
  year: string
  /** 月份目录，如 `10`。 */
  month: string
  /** 日期目录，如 `19`。 */
  day: string
  /** 当日序号目录，如 `01`。 */
  sequence: string
  /** 文章目录名（slug），如 `hello-world`。 */
  slug: string
  /** 是否严格符合 `YYYY/MM/DD/NN/slug` 五层约定。 */
  compliant: boolean
  /** 不符合约定时的原因，便于 `check` 给出可操作的提示。 */
  deviation?: string
}

/** 一份已解析的文章（含 frontmatter 与正文）。 */
export interface PostFile {
  path: PostPathInfo
  /** frontmatter 原始键值。 */
  data: Record<string, unknown>
  /** frontmatter 的行顺序（用于 `fix` 重排时判断是否已有序）。 */
  body: string
  /** 整个文件的原始文本。 */
  raw: string
}

/** 把相对路径按 `/` 拆段。 */
function segmentsOf(filePath: string): string[] {
  return filePath.split('/')
}

/** 文件路径的第一段是否是语言代码。 */
function localeOfPath(filePath: string, fallback: LocaleCode): LocaleCode {
  const first = segmentsOf(filePath)[0]
  return (LOCALE_CODES as readonly string[]).includes(first) ? (first as LocaleCode) : fallback
}

/**
 * 解析文章路径。
 *
 * 宽松处理：路径不符合五层约定时**不报错**，而是标记 `compliant: false`
 * 并给出原因。原因在于 `WRITING.md` 明确说过平铺的 `posts/我的文章/` 也是合法的，
 * 命令不能因为「不符合当前约定」就假装文章不存在——那会让 `posts` 少列文章，
 * 比多列更危险。
 */
export function parsePostPath(filePath: string, locale: LocaleCode): PostPathInfo {
  const segments = segmentsOf(filePath)
  const detectedLocale = localeOfPath(filePath, locale)

  // 去掉语言前缀与 posts 分区，剩下的是文章在分区内的相对层级
  const withoutLocale = (LOCALE_CODES as readonly string[]).includes(segments[0])
    ? segments.slice(1)
    : segments
  const withinSection = withoutLocale[0] === POST_SECTION ? withoutLocale.slice(1) : withoutLocale

  // 最后一层是 index.md（或某个 .md），前面的目录才是层级
  const dirSegments = withinSection.slice(0, -1)

  const base: PostPathInfo = {
    filePath,
    absolutePath: join(DOCS_DIR, filePath),
    locale: detectedLocale,
    url: relativePathToUrl(filePath),
    year: '',
    month: '',
    day: '',
    sequence: '',
    slug: '',
    compliant: false,
  }

  /*
   * 期望：年/月/日/序号/slug 共五层。
   * 少于五层就是平铺写法（`posts/hello/index.md`），符合文档里的「也可以平铺」，
   * 因此标成不符合约定但不视为错误。
   */
  if (dirSegments.length < 5) {
    base.slug = dirSegments[dirSegments.length - 1] ?? ''
    base.deviation = `目录层级为 ${dirSegments.length} 层，约定是 年/月/日/序号/标题 共 5 层`
    return base
  }

  const [year, month, day, sequence] = dirSegments
  const slugSegments = dirSegments.slice(4)

  const isDateShaped =
    /^\d{4}$/.test(year) && /^\d{2}$/.test(month) && /^\d{2}$/.test(day) && /^\d{2}$/.test(sequence)

  if (!isDateShaped) {
    base.slug = slugSegments.join('/')
    base.deviation = `日期层级不符合 YYYY/MM/DD/NN：${year}/${month}/${day}/${sequence}`
    return base
  }

  return {
    ...base,
    year,
    month,
    day,
    sequence,
    slug: slugSegments.join('/'),
    compliant: true,
  }
}

/** 读取并解析一份文章。 */
export function readPostFile(filePath: string, locale: LocaleCode): PostFile {
  const path = parsePostPath(filePath, locale)
  const raw = readFileSync(path.absolutePath, 'utf-8')
  const { data, content } = matter(raw)

  return {
    path,
    data: data as Record<string, unknown>,
    body: content,
    raw,
  }
}

/**
 * 收集某语言（或全部语言）下的文章文件。
 *
 * 判定条件与 `support/content.ts` 的 `isPost()` 严格一致：
 * 位于 `posts/` 分区 **且** `date` 可解析。
 *
 * `includeUndated: true` 时也返回缺 `date` 的文件——仅供 `check` 用来
 * 报告「这篇在 posts 下但没有 date，所以不会被当文章」，正常列举不该带上它。
 */
export function collectPostFiles(
  locale?: LocaleCode,
  options: { includeUndated?: boolean } = {},
): PostFile[] {
  const locales = locale ? [locale] : LOCALE_CODES

  const files: PostFile[] = []
  for (const code of locales) {
    for (const filePath of collectMarkdownFiles(join(DOCS_DIR, code))) {
      // collectMarkdownFiles 返回的是相对 docs/ 的路径，这里补回语言前缀判断
      const first = segmentsOf(filePath)[0]
      const inSection = first === POST_SECTION || segmentsOf(filePath)[1] === POST_SECTION
      if (!inSection) continue

      const post = readPostFile(filePath, code)
      if (!options.includeUndated && parseDate(post.data.date) === null) continue
      files.push(post)
    }
  }

  return files
}

/** 文章的实际日期（frontmatter 优先），无法解析时返回 null。 */
export function postDate(post: PostFile): Date | null {
  return parseDate(post.data.date)
}

/**
 * 该语言某天已占用的序号（`01`、`02`…）。
 *
 * 直接读目录名而不是读全部文章的 frontmatter：序号是**目录约定**，
 * 空目录 / 刚建好还没写 `date` 的目录同样占着号，
 * 若按 frontmatter 算就会把 `02` 分给一个已经有目录的位置。
 */
export function usedSequences(
  locale: LocaleCode,
  dateParts: { year: string; month: string; day: string },
): Set<string> {
  const dayDir = join(
    DOCS_DIR,
    locale,
    POST_SECTION,
    dateParts.year,
    dateParts.month,
    dateParts.day,
  )
  if (!existsSync(dayDir)) return new Set()

  return new Set(
    readdirSync(dayDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  )
}

/** 列出某语言某年某月的日期目录，用于提示「这天已有 N 篇」。 */
export function existingDayDirs(locale: LocaleCode, year: string, month: string): string[] {
  const monthDir = join(DOCS_DIR, locale, POST_SECTION, year, month)
  const stat = statSync(monthDir, { throwIfNoEntry: false })
  if (!stat?.isDirectory()) return []

  return readdirSync(monthDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted()
}
