/**
 * 草稿文章摘要（数据加载器）。
 *
 * **为什么单独一个加载器**：`posts.data.ts` 只下发已发布文章（列表、标签、
 * 搜索、RSS、语言切换全都读它），草稿不能混进去，否则处处都要记得过滤。
 * 但草稿页**仍然会生成**（作者要在浏览器里预览），页面需要一个 `PostSummary`
 * 才能渲染完整的文章版面（字数、阅读时长、标签、页脚动作）——于是把
 * 「草稿」单独下发给文章页识别「当前页是草稿」。
 *
 * 与 `posts.data.ts` 同一套 `toPostSummary()`，字段完全一致，差别只有过滤条件。
 */

import { defineLoader } from 'vitepress'

import { readDraftPosts } from '../support/content'
import type { PostSummary } from '../types'

export type Data = PostSummary[]

declare const data: Data
export { data }

export default defineLoader({
  watch: ['../../**/*.md'],
  load(): Data {
    return readDraftPosts()
  },
})
