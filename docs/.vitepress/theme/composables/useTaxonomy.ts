/**
 * 标签汇总。
 *
 * 由文章列表派生，不额外维护索引：文章改了标签，标签页自然跟着变。
 */

import { computed } from 'vue'

import type { TagSummary } from '../../types'
import { usePosts } from './usePosts'

export function useTaxonomy() {
  const { posts } = usePosts()

  /** 当前语言的标签，按文章数倒序、同数量按名称排序。 */
  const tags = computed<TagSummary[]>(() => {
    const groups = new Map<string, TagSummary>()

    for (const post of posts.value) {
      for (const tag of post.tags) {
        const existing = groups.get(tag.slug)
        if (existing) {
          existing.posts.push(post)
          existing.count += 1
        } else {
          groups.set(tag.slug, { ...tag, count: 1, posts: [post] })
        }
      }
    }

    return [...groups.values()].sort((a, b) => {
      const diff = b.count - a.count
      return diff !== 0 ? diff : a.label.localeCompare(b.label)
    })
  })

  /** 按 slug 取单个标签（标签详情页用）。 */
  function findTag(slug: string): TagSummary | undefined {
    return tags.value.find((tag) => tag.slug === slug)
  }

  return { tags, findTag }
}
