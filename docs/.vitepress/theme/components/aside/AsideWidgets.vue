<script setup lang="ts">
import { computed } from 'vue'

import { SITE } from '../../../data/site'
import LinksCard from './LinksCard.vue'
import ProfileCard from './ProfileCard.vue'
import TagsCard from './TagsCard.vue'
import WidgetsCard from './WidgetsCard.vue'

/**
 * 侧栏容器：按 `data/site.ts` 里 `widgets` 的顺序渲染卡片。
 *
 * 加/删/调序只改数据文件，组件这里不需要改。
 * 渲染前会过滤掉「当前没有内容」的卡片（如没有标签时的标签卡）。
 */

/** 侧栏组件名 → 组件。新增侧栏卡时在这里登记一次。 */
const REGISTRY = {
  profile: ProfileCard,
  tags: TagsCard,
  links: LinksCard,
  custom: WidgetsCard,
} as const

const cards = computed(() => SITE.widgets.map((name) => ({ name, component: REGISTRY[name] })))
</script>

<template>
  <component :is="card.component" v-for="card in cards" :key="card.name" />
</template>
