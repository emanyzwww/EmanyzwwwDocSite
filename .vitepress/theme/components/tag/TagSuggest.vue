<script setup lang="ts">
import { SITE } from '../../../data/site'
import type { TagSummary } from '../../../types'
import { useI18n } from '../../i18n'
import { href } from '../../support/paths'

/**
 * 其他标签（标签详情页底部）。
 *
 * 作用：让标签页之间可以横向跳转，避免内容少的标签页看起来「空了」。
 * 传入的 `tags` 应已排除当前标签。
 */

defineProps<{ tags: TagSummary[] }>()

const { m } = useI18n()
</script>

<template>
  <section v-if="tags.length" class="tag-suggest">
    <h2 class="tag-suggest__title">{{ m.otherTags }}</h2>
    <ul class="tag-list">
      <li v-for="tag in tags.slice(0, SITE.tagSuggestLimit)" :key="tag.slug">
        <a class="tag" :href="href(tag.url)">
          {{ tag.label }}
          <span class="tag__count">{{ tag.count }}</span>
        </a>
      </li>
    </ul>
  </section>
</template>
