/**
 * 上一篇 / 下一篇。
 *
 * 口径：同一语言、同一文章集合（`<YYYYMM>/<DDNN>/` 下的文章）内按时间排序。
 * 与旧站 `PrevInSection` / `NextInSection` 一致——「上一篇」是更早的一篇。
 */

import { useData } from 'vitepress'
import { computed } from 'vue'

import type { PostSummary } from '../../types'
import { toPageUrl } from '../support/paths'
import { usePosts } from './usePosts'

export function useAdjacentPosts() {
  const { page } = useData()
  const { posts } = usePosts()

  const index = computed(() =>
    posts.value.findIndex((post) => post.url === toPageUrl(page.value.relativePath)),
  )

  /** 更早的一篇。 */
  const previous = computed<PostSummary | undefined>(() => {
    if (index.value < 0) return undefined
    return posts.value[index.value + 1]
  })

  /** 更新的一篇。 */
  const next = computed<PostSummary | undefined>(() => {
    if (index.value < 0) return undefined
    return posts.value[index.value - 1]
  })

  return { previous, next }
}
