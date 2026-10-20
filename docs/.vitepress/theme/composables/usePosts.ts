/**
 * 文章列表。
 *
 * 数据在构建期由 `data/posts.data.ts` 生成，这里只做「按语言筛选」，
 * 因此列表页、标签页、统计卡片看到的永远是同一份数据。
 */

import { computed } from 'vue'

import { data as allPosts } from '../../data/posts.data'
import type { PostSummary } from '../../types'
import { useI18n } from '../i18n'

export function usePosts() {
  const { locale } = useI18n()

  /** 当前语言的全部文章（已按时间倒序、已剔除草稿）。 */
  const posts = computed<PostSummary[]>(() =>
    allPosts.filter((post) => post.locale === locale.value),
  )

  return { posts }
}
