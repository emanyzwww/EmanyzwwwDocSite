/**
 * 自定义侧栏卡片（数据加载器）。
 *
 * 过滤掉 `enabled: false` 的条目，并把 `content` 渲染成 HTML。
 */

import { defineLoader } from 'vitepress'

import { renderMarkdown } from '../support/markdown'
import type { RenderedWidget } from '../types'
import { WIDGETS } from './widgets'

export type Data = RenderedWidget[]

declare const data: Data
export { data }

export default defineLoader({
  load(): Data {
    return WIDGETS.filter((widget) => widget.enabled !== false).map((widget) => {
      const rendered: RenderedWidget = { html: renderMarkdown(widget.content) }
      if (widget.id) rendered.id = widget.id
      if (widget.title) rendered.title = widget.title
      return rendered
    })
  },
})
