<script setup lang="ts">
import { useData } from 'vitepress'
import { computed } from 'vue'

import { useTaxonomy } from '../../composables/useTaxonomy'
import { format, useI18n } from '../../i18n'
import RecentPostsCard from '../aside/RecentPostsCard.vue'
import StatsCard from '../aside/StatsCard.vue'
import EmptyState from '../common/EmptyState.vue'
import ThreeColumn from '../layout/ThreeColumn.vue'
import TagCloud from '../tag/TagCloud.vue'
import TagGroups from '../tag/TagGroups.vue'

/**
 * 标签总览页（`layout: tags`）。
 *
 * 组成：标签云（按数量分级字号） + 每个标签的分组卡片。
 * 右侧栏显示站点统计与最近文章，避免大屏下右栏空着。
 */

const { page, frontmatter } = useData()
const { m } = useI18n()
const { tags } = useTaxonomy()

/** 页面大标题用 `page.title`，不含站点名后缀。 */
const heading = computed(() => page.value.title)
</script>

<template>
  <ThreeColumn>
    <header class="page-header">
      <h1 class="page-title">{{ heading }}</h1>
      <p v-if="frontmatter.description" class="page-description">{{ frontmatter.description }}</p>
      <p v-if="tags.length" class="page-description">
        {{ format(m.taxonomyOverview, { count: tags.length }) }}
      </p>
    </header>

    <template v-if="tags.length">
      <TagCloud :tags="tags" />
      <TagGroups :tags="tags" />
    </template>

    <EmptyState v-else :text="m.noTerms" />

    <template #aside>
      <StatsCard />
      <RecentPostsCard />
    </template>
  </ThreeColumn>
</template>
