/**
 * Markdown → HTML 渲染（仅构建期使用）。
 *
 * 用于三处「非页面」的 Markdown：个人简介、自定义侧栏卡片、RSS 全文。
 * 页面正文由 VitePress 自己渲染，不经过这里。
 */

import MarkdownIt from 'markdown-it'

let renderer: MarkdownIt | null = null

function getRenderer(): MarkdownIt {
  renderer ??= new MarkdownIt({
    html: true,
    linkify: true,
    typographer: false,
  })
  return renderer
}

/** 渲染一段 Markdown 为 HTML 片段。 */
export function renderMarkdown(source: string): string {
  return getRenderer().render(source).trim()
}

/** 渲染行内 Markdown（不包 `<p>`）。 */
export function renderInlineMarkdown(source: string): string {
  return getRenderer().renderInline(source).trim()
}
