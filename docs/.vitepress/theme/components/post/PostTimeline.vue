<script setup lang="ts">
/**
 * 时间线文章列表（`/posts/` 使用）。
 *
 * 按年份分组：年份 + 数量在左，右侧用伪元素延伸一条细线（见 posts.css）。
 * 每一行是「日期 | 标题+摘要 | 字数/标签」，窄屏自动收成两行。
 *
 * 与旧站的差异：分组在组件里完成（旧站用 Hugo 的 `GroupByDate`），
 * 直接对已按时间排序的数组做一次遍历，逻辑更直观。
 */
import { computed } from 'vue'

import type { PostSummary } from '../../../types'
import { href } from '../../support/paths'
import PostMeta from './PostMeta.vue'

const props = defineProps<{ posts: PostSummary[] }>()

interface YearGroup {
  year: string
  posts: PostSummary[]
}

const groups = computed<YearGroup[]>(() => {
  const result: YearGroup[] = []
  for (const post of props.posts) {
    const last = result.at(-1)
    if (last?.year === post.year) last.posts.push(post)
    else result.push({ year: post.year, posts: [post] })
  }
  return result
})
</script>

<template>
  <div class="timeline">
    <section v-for="group in groups" :key="group.year" class="tl-year">
      <h2 class="tl-year__label">
        <span>{{ group.year }}</span>
        <span class="tl-year__count">{{ group.posts.length }}</span>
      </h2>

      <ul class="tl-list">
        <li v-for="post in group.posts" :key="post.url" class="tl__item">
          <time class="tl__date" :datetime="post.isoDate">{{ post.dateShort }}</time>

          <span class="tl__main">
            <a class="tl__title" :href="href(post.url)">{{ post.title }}</a>
            <span v-if="post.summary" class="tl__summary">{{ post.summary }}</span>
          </span>

          <PostMeta :post="post" variant="timeline" />
        </li>
      </ul>
    </section>
  </div>
</template>
