/**
 * 站点路径与配置的唯一入口（仅命令行使用）。
 *
 * 所有脚本都必须从**这里**拿目录与语言表，不许各自 `resolve(process.cwd(), 'docs')`：
 * 一旦有人在子目录里执行命令、或以后改了 `srcDir`，散落的硬编码就会分叉。
 *
 * 语言的权威定义仍然在 `.vitepress/data/site.ts`（构建期与主题共用），
 * 这里只做「把它拿出来给命令行用」的转接，不复制一份。
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DEFAULT_LOCALE, LOCALE_CODES, LOCALES, NAV, SITE } from '../../.vitepress/data/site'
import type { LocaleCode, LocaleMeta } from '../../.vitepress/types'

/** 仓库根目录（`scripts/lib/site.ts` 往上两级）。 */
export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))

/** 内容根目录：`docs/`。与 `config.ts` 的 `srcDir` 一致。 */
export const DOCS_DIR = resolve(REPO_ROOT, 'docs')

/** 再导出构建期的同一份定义，脚本里直接用，避免三处各写一遍。 */
export { DEFAULT_LOCALE, LOCALE_CODES, LOCALES, SITE }

/**
 * 站点时区。
 *
 * `pnpm new` 的「今天」、目录名的年/月/日、frontmatter 的 `date` 全部按它算。
 * 取 `site.ts` 的配置而不是写死 `Asia/Shanghai`：站点时区只有一个地方能改。
 */
export const SITE_TIME_ZONE = SITE.timeZone

/** 某语言的内容目录：`docs/zh-cn`。 */
export function localeDir(locale: LocaleCode): string {
  return join(DOCS_DIR, locale)
}

/**
 * 某语言的文章根目录：`docs/zh-cn`。
 *
 * 文章**直接挂在语言目录下**（`<YYYYMM>/<DDNN>/index.md`），不再有 `posts/` 分区。
 * 仍然保留这个函数而不是让调用方自己拼 `localeDir`：文章根与语言根相同是当前布局的
 * 约定，集中在这里以后换布局才不会漏掉某个脚本。
 */
export function articleRootDir(locale: LocaleCode): string {
  return localeDir(locale)
}

/** 某语言的其它页面目录：`docs/zh-cn/pages`（about、文章列表、标签页）。 */
export function pagesDir(locale: LocaleCode): string {
  return join(localeDir(locale), 'pages')
}

/** 语言元信息。 */
export function localeMeta(locale: LocaleCode): LocaleMeta {
  return LOCALES[locale]
}

/** 判断一个字符串是否是合法语言代码。 */
export function isLocaleCode(value: string): value is LocaleCode {
  return (LOCALE_CODES as readonly string[]).includes(value)
}

/**
 * 把用户输入的 `--lang` 收窄成 `LocaleCode`。
 *
 * 与 `site.ts` 的 `asLocale` 不同：那里「不认识就回退默认」，适合构建期的宽输入；
 * 命令行必须**报错**，否则 `-l=zn-cn` 这种手滑会静默生成到中文目录里。
 */
export function parseLocale(value: string | undefined): LocaleCode {
  if (value === undefined || value === '') return DEFAULT_LOCALE
  const normalized = value.toLowerCase()
  if (!isLocaleCode(normalized)) {
    throw new Error(`不支持的语言：${value}（可选：${LOCALE_CODES.join('、')}）`)
  }
  return normalized
}

/** 各语言在导航里的展示名，用于提示信息。 */
export function localeLabel(locale: LocaleCode): string {
  return LOCALES[locale].label
}

/**
 * 递归收集 `dir` 下所有 Markdown，返回**相对 `rootDir`**（默认 `docs/`）的路径。
 *
 * `rootDir` 与 `dir` 分开是为了测试：单测会拿一个临时目录当内容根，
 * 这里仍要返回「相对那个根」的路径，才能让上层按 `docs/` 的规则解析。
 * 生产调用只传 `dir`。
 */
export function collectMarkdownFiles(
  dir: string = DOCS_DIR,
  rootDir: string = DOCS_DIR,
  acc: string[] = [],
): string[] {
  if (!existsSync(dir)) return acc

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      collectMarkdownFiles(full, rootDir, acc)
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      acc.push(relative(rootDir, full).split(sep).join('/'))
    }
  }
  return acc
}

/** 判断路径是否是目录（不抛错）。 */
export function isDirectory(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false
}

/**
 * 生成站内路径（与 `support/urls.ts` 的规则一致，但在命令行做**未编码**展示用）。
 *
 * 这里刻意不复用 `toPageUrl`：命令行要打印给人看的是 `/zh-cn/pages/about/`，
 * 中文 slug 保持原文更易读；真正参与构建的编码由 VitePress 自己完成。
 *
 * 注意文章的真实 URL 由「目录 + slug」拼成（`support/article-path.ts` 的
 * `articleUrlPath`），不走这个通用换算——文章没有文件名，只有 slug。
 */
export function relativePathToUrl(relativePath: string): string {
  const withoutExt = relativePath.replace(/\.md$/, '')
  const withoutIndex = withoutExt.replace(/(^|\/)index$/, '$1')
  return `/${withoutIndex}`.replace(/\/{2,}/g, '/').replace(/\/?$/, '/')
}

/** 供帮助文本使用的语言清单。 */
export function localeOptionsText(): string {
  return LOCALE_CODES.map((code) => `${code}（${LOCALES[code].label}）`).join('、')
}

/**
 * 导航里该语言的文章列表入口，用于 `pnpm new` 的后续提示。
 *
 * 重构后文章列表在 `pages/posts/` 下：按新链接找，找不到时退回同一地址，
 * 而不是悄悄给出旧 `/<lang>/posts/`（那个地址已经不存在了）。
 */
export function postsIndexUrl(locale: LocaleCode): string {
  return (
    NAV[locale].find((item) => item.link.includes('/pages/posts/'))?.link ??
    `/${locale}/pages/posts/`
  )
}
