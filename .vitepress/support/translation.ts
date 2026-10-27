/**
 * 文章跨语言配对（纯函数 + 构建期索引）。
 *
 * 背景缺陷：语言切换与 hreflang 互指原先只做「整条路径换语言前缀」的
 * 字符串匹配（`/zh-cn/202610/1901/你好，世界/` → `/en/202610/1901/你好，世界/`）。
 * 一旦某个语言的 slug 改成本地化写法（英文 `hello-world`、中文 `你好，世界`），
 * 路径就不再同名，匹配失败，切换只会退到目标语言的列表页，
 * SEO 互指也会整段丢失——尽管两篇文章确实是同一篇。
 *
 * 解法参考 Hugo 的 `translationKey`：给同一篇文章的所有语言版本
 * 一个**与语言无关的稳定键**，按键而不是按路径配对。键的来源分两级：
 *
 * 1. **显式**：frontmatter 里写 `translationKey`，优先级最高。
 *    用于编号没对齐、或一篇文章想特别指定配对的情况；
 * 2. **推导**：文章路径符合 `<locale>/<YYYYMM>/<DDNN>/index.md` 时，
 *    取数字段 `<YYYYMM>/<DDNN>` 作键。目录编号本来就是两棵语言树共享的
 *    文章身份，slug 只是展示层，换成中文/英文都不影响它。
 *
 * 其余页面（`pages/about`、列表页等）没有稳定键，维持路径匹配回退。
 */

import type { LocaleCode, PostSummary } from '../types'
import { parseArticlePath } from './article-path'

/**
 * 从 frontmatter / 文件路径推导文章的跨语言配对键；没有稳定键时返回 `null`。
 *
 * @param data   frontmatter（读取 `translationKey`）
 * @param filePath 相对 `docs/` 的路径，如 `zh-cn/202610/1901/index.md`
 */
export function translationKeyOf(data: Record<string, unknown>, filePath: string): string | null {
  // 1. 显式声明优先。空串视同未声明。
  const explicit = data.translationKey
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim()

  // 2. 路径推导：`<locale>/<YYYYMM>/<DDNN>/index.md` → `<YYYYMM>/<DDNN>`
  return parseArticlePath(filePath)?.key ?? null
}

/**
 * 跨语言配对索引：配对键 → 语言 → 文章站点地址（已 URL 编码）。
 *
 * 键冲突（同语言同键出现两篇）以后写的覆盖先写的——目录编号是
 * 手工维护的，重复时与其构建失败，不如保留后一篇并让问题在页面上可见。
 */
export function buildTranslationIndex(
  posts: PostSummary[],
): Map<string, Partial<Record<LocaleCode, string>>> {
  const index = new Map<string, Partial<Record<LocaleCode, string>>>()
  for (const post of posts) {
    if (!post.translationKey) continue
    const entry = index.get(post.translationKey) ?? {}
    entry[post.locale] = post.url
    index.set(post.translationKey, entry)
  }
  return index
}

/**
 * 按配对键查目标语言的文章地址。
 *
 * 只在「目标语言版本真实存在」时才返回地址——拿不到翻译时返回 `null`，
 * 由调用方退回原有的三级回退（同名路径 → 栏目索引 → 语言首页），
 * 与 Hugo「缺翻译就退回」的语义一致。
 */
export function translatedUrl(
  index: Map<string, Partial<Record<LocaleCode, string>>>,
  translationKey: string | null,
  locale: LocaleCode,
): string | null {
  if (!translationKey) return null
  return index.get(translationKey)?.[locale] ?? null
}
