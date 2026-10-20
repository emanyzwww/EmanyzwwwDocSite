<script setup lang="ts">
/**
 * 侧栏标签卡：按文章数取前 N 个标签。
 *
 * 条数上限来自 `data/profile.ts` 的 `tagsLimit`（与旧站一致）。
 */
import { computed } from 'vue'

import { data as profile } from '../../../data/profile.data'
import { useTaxonomy } from '../../composables/useTaxonomy'
import { useI18n } from '../../i18n'
import { href } from '../../support/paths'

const { m } = useI18n()
const { tags } = useTaxonomy()

const visible = computed(() => tags.value.slice(0, Math.max(1, profile.tagsLimit)))
</script>

<template>
  <section v-if="visible.length" class="card">
    <p class="card__title">{{ m.tags }}</p>
    <ul class="tag-list">
      <li v-for="tag in visible" :key="tag.slug">
        <a class="tag" :href="href(tag.url)">
          {{ tag.label }}
          <span class="tag__count">{{ tag.count }}</span>
        </a>
      </li>
    </ul>
  </section>
</template>
