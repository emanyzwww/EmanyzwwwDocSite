/**
 * 当前页面对应的文章数据。
 *
 * 文章页需要日期、字数、标签等信息，这些在构建期已经算在 `posts.data.ts` 里，
 * 这里按 URL 查一次即可，不必在 Markdown frontmatter 里重复声明。
 *
 * 草稿不在 `posts.data.ts` 里，也**不会生成页面**（构建期就被 `srcExclude`
 * 排除），所以这里只有已发布文章一种情况。
 */

import { useData } from 'vitepress'
import { computed } from 'vue'

import { data as posts } from '../../data/posts.data'
import type { PostSummary } from '../../types'
import { toPageUrl } from '../support/paths'

export function useCurrentPost() {
  const { page } = useData()

  const current = computed<PostSummary | undefined>(() => {
    const url = toPageUrl(page.value.relativePath)
    return posts.find((post) => post.url === url)
  })

  return { current }
}
