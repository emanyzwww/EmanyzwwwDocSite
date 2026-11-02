<script setup lang="ts">
import { computed } from 'vue'

import { SITE } from '../../../data/site'
import type { PostSummary } from '../../../types'
import { format, useI18n } from '../../i18n'
import { href } from '../../support/paths'
import AppIcon from '../common/AppIcon.vue'

/**
 * 文章元信息：日期 / 更新日期 / 阅读时长 / 字数 / 标签。
 *
 * 文章页头部、文章卡片、时间线三处都用它，保证口径一致。
 * `variant` 只控制容器与显示哪些项，不复制三份模板：
 * - `full`：文章页，带图标，显示全部字段；
 * - `compact`：卡片，只有日期 / 字数 / 标签（卡片空间紧，不放阅读时长与更新日期）；
 * - `timeline`：时间线行内，**不显示日期**（日期已由左侧 `.tl__date` 独立展示）。
 *
 * 图标的分工：日期 = 日历，阅读时长 = 时钟，**字数不带图标**（「504 字」本身
 * 已经说明了单位，再挂一个时钟会和阅读时长撞语义）。
 *
 * 默认插槽留给文章页塞「另一语言版本」的链接：它属于导航而不是文章事实，
 * 但视觉上必须留在这同一行里（`.post-meta` 是 `flex-wrap` 的，窄屏自然折行）。
 */
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
  tl__meta: props.variant === 'timeline',
}))

const isFull = computed(() => props.variant === 'full')

const showWordCount = computed(() => SITE.wordCount)
const showReadingTime = computed(() => isFull.value && SITE.readingTime)
const showUpdate = computed(() => isFull.value && props.post.updatedText !== null)

/**
 * 是否渲染日期。
 *
 * 时间线布局把日期放在行首的独立列（`.tl__date`），如果这里再渲染一次，
 * 每一行会出现两个一模一样的「10-19」——视觉冗余，读屏还会读两遍。
 */
const showDate = computed(() => props.variant !== 'timeline')
</script>

<template>
  <component :is="tag" :class="wrapperClass">
    <span v-if="showDate" class="post-meta__item">
      <AppIcon v-if="isFull" name="calendar" />
      <time :datetime="post.isoDate">{{ post.dateText }}</time>
    </span>

    <span v-if="showUpdate" class="post-meta__item">
      <time :datetime="post.updatedIso ?? undefined">
        {{ format(m.updatedOn, { date: post.updatedText ?? '' }) }}
      </time>
    </span>

    <span v-if="showReadingTime" class="post-meta__item">
      <AppIcon name="clock" />
      {{ format(m.readingTime, { count: post.readingMinutes }) }}
    </span>

    <span v-if="showWordCount" class="post-meta__item">
      {{ post.wordCount }} {{ m.wordCount }}
    </span>

    <span v-if="post.tags.length" class="post-meta__item">
      <AppIcon v-if="isFull" name="tag" />
      <template v-for="(tag, index) in post.tags" :key="tag.slug">
        <span v-if="index > 0"> · </span>
        <a :href="href(tag.url)">{{ tag.label }}</a>
      </template>
    </span>

    <slot />
  </component>
</template>
