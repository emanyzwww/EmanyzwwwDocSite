/**
 * 自定义侧栏卡片。
 *
 * 想加一张卡片，照着格式加一条即可；`content` 支持 Markdown 与 HTML。
 * 设为 `enabled: false` 可临时停用（比删掉更适合「先放着」的场景）。
 */

import type { WidgetDef } from '../types'

export const WIDGETS: WidgetDef[] = [
  {
    title: '关于这个站',
    enabled: false,
    content: `用 [VitePress](https://vitepress.dev/) 搭建，样式是一套自写的设计令牌系统，支持明暗主题。`,
  },
  {
    title: '最近在读',
    enabled: false,
    content: `- 《某某书》
- 《另一本》`,
  },
  {
    title: '现在',
    enabled: false,
    content: '这条被 `enabled: false` 关掉了，想启用就删掉这一行。',
  },
]
