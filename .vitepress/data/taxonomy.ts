/**
 * 标签配置（可选）。
 *
 * 默认行为：标签名即 URL 片段，因此 `/tags/随笔/` 这类中文地址可以照常使用。
 * 如果想把中文标签映射到英文 slug（更利于分享），在 `TAG_SLUGS` 里加一条即可：
 *
 *   export const TAG_SLUGS = { 随笔: 'essay' }   // /tags/随笔/ → /tags/essay/
 *
 * 注意：改了 slug 就等于换了地址，旧地址会 404；如需保留旧链接，
 * 可在 `docs/public/` 下放跳转页，或干脆不改。
 */

/** 标签原文 → URL 片段。 */
export const TAG_SLUGS: Record<string, string> = {}

/** 标签原文 → 展示名（用于统一大小写、写全称等）。 */
export const TAG_LABELS: Record<string, string> = {}
