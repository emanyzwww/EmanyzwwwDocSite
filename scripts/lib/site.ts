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

/** 文章所在的分区名。与 `support/content.ts` 的 `POST_SECTION` 保持一致。 */
export const POST_SECTION = 'posts'

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

/** 某语言的文章根目录：`docs/zh-cn/posts`。 */
export function postsDir(locale: LocaleCode): string {
  return join(localeDir(locale), POST_SECTION)
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

/** 递归收集 `docs/` 下所有 Markdown（相对 `docs/`，`/` 分隔）。 */
export function collectMarkdownFiles(dir: string = DOCS_DIR, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      collectMarkdownFiles(full, acc)
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      acc.push(relative(DOCS_DIR, full).split(sep).join('/'))
    }
  }
  return acc
}

/** 目录 mtime 排序用的工具，保持列表输出稳定。 */
export function isDirectory(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false
}

/**
 * 生成站内路径（与 `support/urls.ts` 的规则一致，但在命令行做**未编码**展示用）。
 *
 * 这里刻意不复用 `toPageUrl`：命令行要打印给人看的是 `/zh-cn/posts/2026/.../`,
 * 中文 slug 保持原文更易读；真正参与构建的编码由 VitePress 自己完成。
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

/** 导航里该语言的文章列表入口，用于 `pnpm new` 的后续提示。 */
export function postsIndexUrl(locale: LocaleCode): string {
  return NAV[locale].find((item) => item.link.includes(`/${POST_SECTION}/`))?.link ?? `/${locale}/`
}
