/**
 * 上一篇 / 下一篇。
 *
 * 口径：同一语言、同一分区（`posts`）内按时间排序。
 * 与旧站 `PrevInSection` / `NextInSection` 一致——「上一篇」是更早的一篇。
 */

import { useData } from 'vitepress'
import { computed } from 'vue'

import type { PostSummary } from '../../types'
import { usePosts } from './usePosts'

export function useAdjacentPosts() {
  const { page } = useData()
  const { posts } = usePosts()

  const index = computed(() =>
    posts.value.findIndex((post) => post.url === normalize(page.value.relativePath)),
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

/** `posts/hello-world/index.md` → `/posts/hello-world/`。 */
function normalize(relativePath: string): string {
  const withoutExt = relativePath.replace(/\.md$/, '')
  const withoutIndex = withoutExt.replace(/(^|\/)index$/, '$1')
  return `/${withoutIndex}`.replace(/\/{2,}/g, '/').replace(/\/?$/, '/')
}
