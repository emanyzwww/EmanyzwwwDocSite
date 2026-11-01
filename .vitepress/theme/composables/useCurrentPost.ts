/**
 * 当前页面对应的文章数据。
 *
 * 文章页需要日期、字数、标签等信息，这些在构建期已经算在 `posts.data.ts` 里，
 * 这里按 URL 查一次即可，不必在 Markdown frontmatter 里重复声明。
 *
 * **草稿也要认得出来**：草稿不在 `posts.data.ts` 里（列表/标签/搜索/RSS 都读它），
 * 但草稿页必须能渲染完整版面并显示「草稿」徽章，所以这里再查一次
 * `drafts.data.ts`。命中哪个都返回同一个 `PostSummary` 形状。
 */

import { useData } from 'vitepress'
import { computed } from 'vue'

import { data as draftPosts } from '../../data/drafts.data'
import { data as publishedPosts } from '../../data/posts.data'
import type { PostSummary } from '../../types'
import { toPageUrl } from '../support/paths'

export function useCurrentPost() {
  const { page } = useData()

  const current = computed<PostSummary | undefined>(() => {
    const url = toPageUrl(page.value.relativePath)
    return (
      publishedPosts.find((post) => post.url === url) ?? draftPosts.find((post) => post.url === url)
    )
  })

  /** 当前页是不是草稿（`draft: true`）。 */
  const isDraft = computed(() => current.value?.draft === true)

  return { current, isDraft }
}
