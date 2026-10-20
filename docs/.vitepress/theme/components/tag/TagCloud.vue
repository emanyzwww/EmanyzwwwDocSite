<script setup lang="ts">
/**
 * 标签云。
 *
 * 字号分级：按「文章数」在 [min, max] 区间里的位置映射到 1–5 级
 * （与旧站 taxonomy.html 的算法一致；只有一种数量时统一为 1 级）。
 */
import { computed } from 'vue'

import type { TagSummary } from '../../../types'
import { useI18n } from '../../i18n'
import { href } from '../../support/paths'

const props = defineProps<{ tags: TagSummary[] }>()

const { m } = useI18n()

const levels = computed<Map<string, number>>(() => {
  const counts = props.tags.map((tag) => tag.count)
  const max = Math.max(...counts, 1)
  const min = Math.min(...counts, 1)
  const result = new Map<string, number>()

  for (const tag of props.tags) {
    // 全部相同 → 都是 1 级；否则把 [min,max] 线性映射到 [1,5]
    const level = max === min ? 1 : 1 + Math.round(((tag.count - min) / (max - min)) * 4)
    result.set(tag.slug, Math.min(5, Math.max(1, level)))
  }

  return result
})
</script>

<template>
  <div v-if="tags.length" class="cloud">
    <p class="cloud__hint">{{ m.tagCloudHint }}</p>
    <ul class="cloud__list">
      <li v-for="tag in tags" :key="tag.slug">
        <a class="cloud__item" :class="`cloud__item--${levels.get(tag.slug) ?? 1}`" :href="href(tag.url)">
          <span class="cloud__name">{{ tag.label }}</span>
          <span class="cloud__count">{{ tag.count }}</span>
        </a>
      </li>
    </ul>
  </div>
</template>
