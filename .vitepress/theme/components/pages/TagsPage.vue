<script setup lang="ts">
import { useData } from 'vitepress'
import { computed } from 'vue'

import { useTaxonomy } from '../../composables/useTaxonomy'
import { format, useI18n } from '../../i18n'
import { href, withLocale } from '../../support/paths'
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
const { locale, m } = useI18n()
const { tags } = useTaxonomy()

/** 页面大标题用 `page.title`，不含站点名后缀。 */
const heading = computed(() => page.value.title)

/** 标签总览说明：只有 1 个标签时英文要用单数（中文两者相同）。 */
const overview = computed(() =>
  format(tags.value.length === 1 ? m.value.taxonomyOverviewOne : m.value.taxonomyOverview, {
    count: tags.value.length,
  }),
)

/** 空态出口：一个标签都没有时，首页是唯一还有内容的落点。 */
const homeLink = computed(() => href(withLocale('/', locale.value)))
</script>

<template>
  <ThreeColumn>
    <header class="page-header">
      <h1 class="page-title">{{ heading }}</h1>
      <p v-if="frontmatter.description" class="page-description">{{ frontmatter.description }}</p>
      <p v-if="tags.length" class="page-meta-line">
        {{ overview }}
      </p>
    </header>

    <template v-if="tags.length">
      <!--
        只有一个标签时不渲染标签云：分级字号此时恒为最小档，
        而「标签越大代表文章越多」的提示在一屏里只有 1 个标签时是自反的。
        分组卡已经完整表达了同一件事。
      -->
      <TagCloud v-if="tags.length > 1" :tags="tags" />
      <TagGroups :tags="tags" />
    </template>

    <EmptyState
      v-else
      :text="m.noTerms"
      icon="tag"
      :action="{ label: m.backHome, href: homeLink }" />

    <template #aside>
      <StatsCard />
      <RecentPostsCard />
    </template>
  </ThreeColumn>
</template>
