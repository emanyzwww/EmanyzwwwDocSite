/**
 * slug 规则（纯函数，构建期 / 命令行 / 测试共用）。
 *
 * slug 是**文章 URL 的标题段**：`/zh-cn/202610/1901/<slug>/`。
 * 它只活在 URL 里，不参与文件系统路径（文章目录永远是 `YYYYMM/DDNN/`），
 * 所以 Windows 文件名限制与它无关——这点是重构后最大的简化。
 *
 * ## 规则（拍板项：中文保留原样、拉丁走 kebab-case）
 *
 * | 标题 | slug |
 * | --- | --- |
 * | `你好，世界` | `你好，世界`（全角标点原样保留） |
 * | `Hello, World!` | `hello-world` |
 * | `Markdown 语法测试` | `Markdown-语法测试`（中文保留，空白/半角标点变 `-`） |
 * | `重构: 一次改造` | `重构-一次改造` |
 *
 * 判据是「标题里有没有 CJK 字符」：
 * - **有 CJK**：尽量保留作者写的字（中文标点在地址栏里显示就是原样），
 *   只把空白与半角标点折叠成 `-`，并去掉会破坏 URL 的字符；
 * - **纯拉丁**：走经典 kebab-case（小写、去变音符号、非字母数字变 `-`）。
 *
 * 这样做的好处：中文地址看起来和标题一致（`你好，世界`），英文地址保持
 * 现有的 `hello-world` 风格，不会出现 `Hello,-World!` 这种丑地址。
 */

/** CJK 字符：中日韩统一表意文字 + 假名 + 谚文。 */
const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/

/** 会破坏 URL（或在不同服务器上行为不一致）的字符。 */
const URL_BREAKING_RE = /[/\\?#%[\]{}|<>"*^`\p{Cc}]/gu

/** 同一组字符的非全局版本：`isUsableSlug()` 用它做一次性判断（`g` 会带 lastIndex 状态）。 */
const URL_BREAKING_CHAR_RE = /[/\\?#%[\]{}|<>"*^`\p{Cc}]/u

/** 半角标点：中文标题里出现时当作分隔符（全角标点不在此列，会保留）。 */
const ASCII_PUNCT_RE = /[!-/:-@[-`{-~]/g

/** 把连续分隔符收敛成一个 `-`，并去掉首尾。 */
function collapse(value: string): string {
  return value.replace(/-+/g, '-').replace(/^[-.\s]+|[-.\s]+$/g, '')
}

/**
 * 由标题推导 slug。
 *
 * 空标题返回空串（调用方决定回退成什么，`slugOf()` 会退到 `untitled`）。
 */
export function slugify(title: string): string {
  const trimmed = title.trim()
  if (!trimmed) return ''

  if (CJK_RE.test(trimmed)) {
    const cleaned = trimmed
      .replace(URL_BREAKING_RE, '-')
      .replace(ASCII_PUNCT_RE, '-')
      .replace(/\s+/g, '-')

    return collapse(cleaned)
  }

  return collapse(
    trimmed
      .normalize('NFKD')
      // 去变音符号：`é` → `e`，保持 URL 干净
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-'),
  )
}

/**
 * slug 是否可用作 URL 段落。
 *
 * 规则刻意保守：只拒绝「一定会坏」的形态，不追求 ASCII 化
 * （中文 slug 是本站的既定选择）。`pnpm check` 用它给出告警。
 */
export function isUsableSlug(slug: string): boolean {
  if (slug === '' || slug !== slug.trim()) return false
  if (slug === '.' || slug === '..') return false
  if (URL_BREAKING_CHAR_RE.test(slug)) return false
  if (/\s/.test(slug)) return false
  if (slug.startsWith('-') || slug.endsWith('-')) return false
  if (slug.startsWith('.') || slug.endsWith('.')) return false
  return true
}

/**
 * 一篇文章最终使用的 slug。
 *
 * 优先级：frontmatter 的 `slug`（可用时）→ 由 `title` 推导 → `untitled`。
 *
 * 「显式写错了」不会静默生效：构建期用推导值保证页面能出，
 * `pnpm check` 会明确报告「slug 不可用」让作者修。
 */
export function slugOf(data: Record<string, unknown>): string {
  const explicit = data.slug
  if (typeof explicit === 'string' && isUsableSlug(explicit)) return explicit

  const title = typeof data.title === 'string' ? data.title : ''
  const derived = slugify(title)
  return isUsableSlug(derived) ? derived : 'untitled'
}
