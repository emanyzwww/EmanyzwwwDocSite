<script setup lang="ts">
import { useData } from 'vitepress'
import { computed } from 'vue'

import { useTaxonomy } from '../../composables/useTaxonomy'
import { format, useI18n } from '../../i18n'
import { decodePath } from '../../support/paths'
import RecentPostsCard from '../aside/RecentPostsCard.vue'
import StatsCard from '../aside/StatsCard.vue'
import EmptyState from '../common/EmptyState.vue'
import ThreeColumn from '../layout/ThreeColumn.vue'
import PostCard from '../post/PostCard.vue'
import TagSuggest from '../tag/TagSuggest.vue'

/**
 * 标签详情页（`layout: tag`，由动态路由 `docs/zh-cn/tags/[tag]/index.md` 生成）。
 *
 * 页面参数 `params.tag` 可能是原文（构建期传入）也可能是百分号编码
 * （客户端从 URL 解析），统一用 `decodePath` 归一成原文再和 `tag.slug` 比对。
 */

const { params } = useData()
const { m } = useI18n()
const { tags, findTag } = useTaxonomy()

/** 当前标签的 slug（归一成原文，与 `TagRef.slug` 同一形式）。 */
const slug = computed(() => decodePath(String(params.value?.tag ?? '')))

const tag = computed(() => findTag(slug.value))

/** 其他标签：排除自己，按文章数取前若干个。 */
const others = computed(() => tags.value.filter((item) => item.slug !== slug.value))

/** 文章数说明：只有 1 篇时英文用单数（中文两者相同）。 */
const countText = computed(() => {
  const count = tag.value?.count ?? 0
  return format(count === 1 ? m.value.termCountOne : m.value.termCount, { count })
})
</script>

<template>
  <ThreeColumn>
    <header class="page-header">
      <p class="page-eyebrow">{{ m.postsInTag }}</p>
      <h1 class="page-title">
        <span class="tag tag--current">{{ tag?.label ?? slug }}</span>
      </h1>
      <p v-if="tag" class="page-description">
        {{ countText }}
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
