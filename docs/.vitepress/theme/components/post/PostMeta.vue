<script setup lang="ts">
/**
 * 文章元信息：日期 / 字数 / 标签 / 草稿标记。
 *
 * 文章页头部、文章卡片、时间线三处都用它，保证口径一致。
 * `variant` 只控制容器与日期格式，不复制三份模板：
 * - `full`：文章页，带日历图标与完整日期
 * - `compact`：卡片，纯日期
 * - `timeline`：时间线行内的 `<span>` 容器
 */
import { computed } from 'vue'

import { SITE } from '../../../data/site'
import type { PostSummary } from '../../../types'
import { useI18n } from '../../i18n'
import { href } from '../../support/paths'
import AppIcon from '../common/AppIcon.vue'

const props = withDefaults(
  defineProps<{
    post: PostSummary
    variant?: 'full' | 'compact' | 'timeline'
  }>(),
  { variant: 'full' },
)

const { m } = useI18n()

/** 容器元素：时间线在 `<li>` 里，只能放行内元素。 */
const tag = computed(() => (props.variant === 'timeline' ? 'span' : 'div'))

const wrapperClass = computed(() => ({
  'post-meta': props.variant === 'full',
  'post-card__meta': props.variant === 'compact',
  'tl__meta': props.variant === 'timeline',
}))

const showWordCount = computed(() => SITE.wordCount)
</script>

<template>
  <component :is="tag" :class="wrapperClass">
    <span class="post-meta__item">
      <AppIcon v-if="props.variant === 'full'" name="calendar" />
      <time :datetime="post.isoDate">{{ props.variant === 'timeline' ? post.dateShort : post.dateText }}</time>
    </span>

    <span v-if="showWordCount" class="post-meta__item">
      <AppIcon v-if="props.variant === 'full'" name="clock" />
      {{ post.wordCount }} {{ m.wordCount }}
    </span>

    <span v-if="post.tags.length" class="post-meta__item">
      <AppIcon v-if="props.variant === 'full'" name="tag" />
      <template v-for="(tag, index) in post.tags" :key="tag.slug">
        <span v-if="index > 0"> · </span>
        <a :href="href(tag.url)">{{ tag.label }}</a>
      </template>
    </span>

    <span v-if="post.draft" class="badge">{{ m.draft }}</span>
  </component>
</template>
