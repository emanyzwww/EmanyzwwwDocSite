<script setup lang="ts">
/**
 * 站点统计卡：文章数 + 标签数。
 *
 * 数据由文章列表与标签汇总即时算出，不需要单独维护计数。
 */
import { computed } from 'vue'

import { useTaxonomy } from '../../composables/useTaxonomy'
import { usePosts } from '../../composables/usePosts'
import { useI18n } from '../../i18n'

const { m } = useI18n()
const { posts } = usePosts()
const { tags } = useTaxonomy()

const stats = computed(() => [
  { label: m.value.totalPosts, value: posts.value.length },
  { label: m.value.totalTags, value: tags.value.length },
])
</script>

<template>
  <div class="card">
    <p class="card__title">{{ m.siteStats }}</p>
    <ul class="stat-list">
      <li v-for="stat in stats" :key="stat.label">
        <span class="stat-list__label">{{ stat.label }}</span>
        <span class="stat-list__value">{{ stat.value }}</span>
      </li>
    </ul>
  </div>
</template>
