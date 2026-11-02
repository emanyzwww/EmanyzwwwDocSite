/**
 * 文章跨语言配对（纯函数 + 构建期索引）。
 *
 * 配对键就是文章源路径的父目录 `<YYYYMM>/<DDNN>`：同一目录下的
 * `zh-cn/index.md` 与 `en/index.md` 是同一篇文章，各自 slug 可以本地化。
 * 配对关系由目录结构本身表达，frontmatter 不再有 `translationKey` 字段，
 * 也不存在手工覆盖入口。
 *
 * 其余页面（`site/<locale>/pages/about`、列表页等）没有配对键，
 * 语言切换与 hreflang 对它们维持路径匹配回退。
 */

import type { LocaleCode, PostSummary } from '../types'
import { parseArticlePath } from './article-path'

/**
 * 从文章源路径推导配对键；非文章返回 `null`。
 *
 * @param filePath 相对 `docs/` 的路径，如 `202610/1901/zh-cn/index.md`
 */
export function pairKeyOf(filePath: string): string | null {
  return parseArticlePath(filePath)?.key ?? null
}

/**
 * 跨语言配对索引：配对键 → 语言 → 文章站点地址（已 URL 编码）。
 *
 * 同一配对键下每种语言最多一篇（一个 `<DDNN>/<locale>/index.md`），
 * 因此不存在键冲突；这里仍用覆盖写法，保持调用方无需关心顺序。
 */
export function buildTranslationIndex(
  posts: PostSummary[],
): Map<string, Partial<Record<LocaleCode, string>>> {
  const index = new Map<string, Partial<Record<LocaleCode, string>>>()
  for (const post of posts) {
    if (!post.pairKey) continue
    const entry = index.get(post.pairKey) ?? {}
    entry[post.locale] = post.url
    index.set(post.pairKey, entry)
  }
  return index
}

/**
 * 按配对键查目标语言的文章地址。
 *
 * 只在「目标语言版本真实存在」时才返回地址——拿不到翻译时返回 `null`，
 * 由调用方退回原有的三级回退（同名路径 → 栏目索引 → 语言首页）。
 */
export function translatedUrl(
  index: Map<string, Partial<Record<LocaleCode, string>>>,
  pairKey: string | null,
  locale: LocaleCode,
): string | null {
  if (!pairKey) return null
  return index.get(pairKey)?.[locale] ?? null
}
