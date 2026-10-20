/**
 * 全站文章摘要（数据加载器）。
 *
 * 客户端通过 `import { data as posts } from '../../data/posts.data'` 拿到数组，
 * 无需任何运行时请求；字数、日期文本等都在构建期算好。
 */

import { defineLoader } from 'vitepress'

import { readPosts } from '../support/content'
import type { PostSummary } from '../types'

export type Data = PostSummary[]

declare const data: Data
export { data }

export default defineLoader({
  watch: ['../../**/*.md'],
  load(): Data {
    return readPosts()
  },
})
