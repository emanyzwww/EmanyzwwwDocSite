/**
 * 个人资料（数据加载器）。
 *
 * `bio` 在这里就渲染成 HTML，客户端只负责显示。
 */

import { defineLoader } from 'vitepress'

import { renderMarkdown } from '../support/markdown'
import type { RenderedProfile } from '../types'
import { PROFILE } from './profile'

export type Data = RenderedProfile

declare const data: Data
export { data }

export default defineLoader({
  load(): Data {
    const { bio, ...rest } = PROFILE
    return { ...rest, bioHtml: renderMarkdown(bio) }
  },
})
