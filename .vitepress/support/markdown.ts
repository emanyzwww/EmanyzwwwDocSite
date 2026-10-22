/**
 * Markdown → HTML 渲染（仅构建期使用）。
 *
 * 用于三处「非页面」的 Markdown：个人简介、自定义侧栏卡片、RSS 全文。
 * 页面正文由 VitePress 自己渲染，不经过这里。
 */

import MarkdownIt from 'markdown-it'

import { extendMarkdown } from './markdown-plugins'

let renderer: MarkdownIt | null = null

function getRenderer(): MarkdownIt {
  renderer ??= new MarkdownIt({
    html: true,
    linkify: true,
    typographer: false,
    // 与页面正文用同一套扩展语法，否则 `==高亮==`、`- [x] 任务`
    // 在 RSS 全文与侧栏卡片里会退化成纯文本
  }).use(extendMarkdown)
  return renderer
}

/** 渲染一段 Markdown 为 HTML 片段。 */
export function renderMarkdown(source: string): string {
  return getRenderer().render(source).trim()
}
