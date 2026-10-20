<script setup lang="ts">
/**
 * 文章卡片（首页、标签详情页使用）。
 *
 * 标题链接用 `::after` 铺满整张卡片：整卡可点，但只保留一个 Tab 焦点，
 * 避免读屏与键盘用户在同一张卡上停两次。
 */
import type { PostSummary } from '../../../types'
import { href } from '../../support/paths'
import PostMeta from './PostMeta.vue'

defineProps<{ post: PostSummary }>()
</script>

<template>
  <article class="post-card">
    <a class="post-card__link" :href="href(post.url)">
      <h2 class="post-card__title">{{ post.title }}</h2>
    </a>
    <p v-if="post.summary" class="post-card__summary">{{ post.summary }}</p>
    <PostMeta :post="post" variant="compact" />
  </article>
</template>
