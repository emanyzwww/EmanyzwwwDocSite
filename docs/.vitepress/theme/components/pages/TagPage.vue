<script setup lang="ts">
/**
 * 标签详情页（`layout: tag`，由动态路由 `docs/tags/[tag]/index.md` 生成）。
 *
 * 页面参数 `params.tag` 是标签的 URL 片段（中文标签会是百分号编码），
 * 这里解码后到标签汇总里找对应项。
 */
import { computed } from 'vue'

import { useData } from 'vitepress'

import { useTaxonomy } from '../../composables/useTaxonomy'
import { format, useI18n } from '../../i18n'
import EmptyState from '../common/EmptyState.vue'
import ThreeColumn from '../layout/ThreeColumn.vue'
import RecentPostsCard from '../aside/RecentPostsCard.vue'
import StatsCard from '../aside/StatsCard.vue'
import PostCard from '../post/PostCard.vue'
import TagSuggest from '../tag/TagSuggest.vue'

const { params } = useData()
const { m } = useI18n()
const { tags, findTag } = useTaxonomy()

/** 当前标签的 slug（动态路由参数传入时已被编码，这里解码一次）。 */
const slug = computed(() => {
  const raw = String(params.value?.tag ?? '')
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
})

const tag = computed(() => findTag(slug.value))

/** 其他标签：排除自己，按文章数取前若干个。 */
const others = computed(() => tags.value.filter((item) => item.slug !== slug.value))
</script>

<template>
  <ThreeColumn>
    <header class="page-header">
      <p class="page-eyebrow">{{ m.postsInTag }}</p>
      <h1 class="page-title">
        <span class="tag tag--current">{{ tag?.label ?? slug }}</span>
      </h1>
      <p v-if="tag" class="page-description">
        {{ format(m.termCount, { count: tag.count }) }}
      </p>
    </header>

    <template v-if="tag && tag.posts.length">
      <div class="post-list">
        <PostCard v-for="post in tag.posts" :key="post.url" :post="post" />
      </div>
    </template>

    <EmptyState v-else :text="m.noPostsInTerm" />

    <TagSuggest v-if="others.length" :tags="others" />

    <template #aside>
      <StatsCard />
      <RecentPostsCard />
    </template>
  </ThreeColumn>
</template>
