/**
 * 文章路径规则（纯函数，构建期 / 命令行共用）。
 *
 * ## 唯一形态
 *
 * ```text
 * docs/<YYYYMM>/<DDNN>/<locale>/index.md
 *   例：docs/202610/1901/zh-cn/index.md
 * ```
 *
 * - `YYYYMM`：年 + 月，如 `202610`；
 * - `DDNN`：两位「日」+ 两位「当日序号」，如 `1901` = 19 日第 01 篇；
 * - `locale`：`zh-cn` / `en`，是**文章目录下的语言子目录**。
 *
 * 目录里**不出现标题**：标题只存在 frontmatter 的 `title` / `slug` 里。
 * URL 由「语言 + 日期目录 + slug」拼出来（语言仍在最前面，与站点页面一致）：
 *
 * ```text
 * /zh-cn/202610/1901/<slug>/
 * ```
 *
 * 这条拼接发生在 `config.ts` 的 `rewrites`（构建期映射）里。由于映射与
 * 文章列表、语言切换、RSS 都必须用同一套规则，本文件是**唯一实现**：
 * `support/content.ts`（站点数据）、`config.ts`（rewrites）、
 * `scripts/lib/*`（命令行）都从这里取，不许再各写一份正则。
 *
 * ## 站点页面
 *
 * 非文章页面在 `docs/site/<locale>/**` 下，**去掉 `site/` 前缀就是 URL**：
 *
 * ```text
 * docs/site/zh-cn/pages/about/index.md → /zh-cn/pages/about/
 * ```
 *
 * 因此「页面语言」对文章看第 3 段、对站点页面看第 2 段，统一由
 * `localeOfDocPath()` 回答，调用方不要再自己 `split('/')[0]`。
 *
 * 与 `support/urls.ts` 的分工：那里负责「相对路径 → 站内 URL」的通用换算，
 * 这里只负责「一篇文章的身份（年月/日序号/语言）长什么样」。
 */

import { asLocale, LOCALE_CODES } from '../data/site'
import type { LocaleCode } from '../types'

/** 站点页面的根目录名（相对 `docs/`）。 */
export const SITE_PAGES_ROOT = 'site'

/** 文章源文件的固定形态：`<YYYYMM>/<DDNN>/<locale>/index.md`。 */
export const ARTICLE_FILE_RE = /^(\d{6})\/(\d{4})\/([a-z-]+)\/index\.md$/

/** 文章 URL 的裸形态（不含语言前缀）：`<YYYYMM>/<DDNN>/<slug>/`。 */
const ARTICLE_BARE_URL_RE = /^(\d{6})\/(\d{4})\/([^/]+)\/?$/

/** 从文章路径里解析出来的身份信息。 */
export interface ArticlePathParts {
  /** 所属语言。 */
  locale: LocaleCode
  /** 年月目录，如 `202610`。 */
  month: string
  /** 日 + 序号目录，如 `1901`。 */
  daySeq: string
  /** 两位「日」，如 `19`。 */
  day: string
  /** 两位「当日序号」，如 `01`。 */
  sequence: string
  /** 文章身份键：`<YYYYMM>/<DDNN>`，即跨语言配对键。 */
  key: string
  /** 目录日期 `YYYYMMDD`，用于和 frontmatter 的 `date` 对比。 */
  dateKey: string
}

/** 一份「今天」或「指定日期」的年月日。 */
export interface ArticleDateParts {
  year: string
  month: string
  day: string
}

/** 统一成正斜杠、去掉前导斜杠。 */
function normalizeDocPath(filePath: string): string {
  return filePath.replace(/^\/+/, '').replace(/\\/g, '/')
}

/**
 * 解析文章源文件路径。
 *
 * 输入必须是相对 `docs/` 的路径（`/` 分隔）。不是文章形态时返回 `null`
 * ——调用方据此决定「这是普通页面」。宽松（不抛错）是刻意的：
 * `site/` 下的任何页面都会走这里，它本来就不是文章。
 */
export function parseArticlePath(filePath: string): ArticlePathParts | null {
  const normalized = normalizeDocPath(filePath)
  const match = ARTICLE_FILE_RE.exec(normalized)
  if (!match) return null

  const [, month, daySeq, locale] = match
  if (!(LOCALE_CODES as readonly string[]).includes(locale)) return null

  const day = daySeq.slice(0, 2)
  const sequence = daySeq.slice(2)

  return {
    locale: locale as LocaleCode,
    month,
    daySeq,
    day,
    sequence,
    key: `${month}/${daySeq}`,
    dateKey: `${month}${day}`,
  }
}

/** 是否文章源文件（只看路径，不看 frontmatter）。 */
export function isArticlePath(filePath: string): boolean {
  return parseArticlePath(filePath) !== null
}

/**
 * 文章真正的 route 路径（`rewrites` 的目标）。
 *
 * `202610/1901/zh-cn/index.md` + `你好，世界`
 *   → `zh-cn/202610/1901/你好，世界/index.md`
 *
 * 返回值带 `.md`：VitePress 的 `rewrites` 以文件路径为键值，扩展名不能省。
 */
export function articleRoutePath(filePath: string, slug: string): string | null {
  const parts = parseArticlePath(filePath)
  if (!parts) return null
  return `${parts.locale}/${parts.month}/${parts.daySeq}/${slug}/index.md`
}

/** 文章源文件路径（相对 `docs/`）：`202610/1901/zh-cn/index.md`。 */
export function articleSourcePath(locale: LocaleCode, month: string, daySeq: string): string {
  return `${month}/${daySeq}/${locale}/index.md`
}

/** 文章 URL（未编码、结尾带斜杠）：`/zh-cn/202610/1901/你好，世界/`。 */
export function articleUrlPath(
  locale: LocaleCode,
  month: string,
  daySeq: string,
  slug: string,
): string {
  return `/${locale}/${month}/${daySeq}/${slug}/`
}

/**
 * 由年月日 + 当日序号算出两个目录段。
 *
 * @example
 * articleDirOf({year:'2026',month:'10',day:'19'}, '01')
 * // { month: '202610', daySeq: '1901' }
 */
export function articleDirOf(
  date: ArticleDateParts,
  sequence: string,
): { month: string; daySeq: string } {
  return {
    month: `${date.year}${date.month}`,
    daySeq: `${date.day}${sequence}`,
  }
}

/**
 * 站点页面的 route 路径：去掉 `site/` 前缀。
 *
 * `site/zh-cn/pages/about/index.md` → `zh-cn/pages/about/index.md`。
 * 不在 `site/` 下时返回 `null`（调用方原样返回）。
 */
export function siteRoutePath(filePath: string): string | null {
  const normalized = normalizeDocPath(filePath)
  const prefix = `${SITE_PAGES_ROOT}/`
  if (!normalized.startsWith(prefix)) return null
  return normalized.slice(prefix.length)
}

/**
 * 一份文档所属的语言（**源路径**口径，不是 URL）。
 *
 * - 文章：`<YYYYMM>/<DDNN>/<locale>/index.md` 的第 3 段；
 * - 站点页面：`site/<locale>/...` 的第 2 段；
 * - 其它（理论上不存在）：首段，认不出时回退默认语言。
 *
 * 为什么必须集中在这里：文章的语言在**第 3 段**，旧代码一律取首段，
 * 迁移后会把英文文章静默归成默认语言（URL 仍正确，错误被掩盖）。
 */
export function localeOfDocPath(filePath: string): LocaleCode {
  const parts = parseArticlePath(filePath)
  if (parts) return parts.locale

  const segments = normalizeDocPath(filePath).split('/')
  if (segments[0] === SITE_PAGES_ROOT && segments[1]) {
    if ((LOCALE_CODES as readonly string[]).includes(segments[1])) {
      return segments[1] as LocaleCode
    }
  }
  return asLocale(segments[0])
}

/**
 * 是否是文章 URL 的裸形态（已去掉语言前缀，`<YYYYMM>/<DDNN>/<slug>/`）。
 *
 * 语言切换在「目标语言没有这篇翻译」时要回退到文章列表页，靠它判断
 * 「当前页是不是文章」。放在这里而不是组件里，是为了和源路径规则同源。
 */
export function isArticleUrlPath(path: string): boolean {
  return ARTICLE_BARE_URL_RE.test(path.replace(/^\/+/, ''))
}
