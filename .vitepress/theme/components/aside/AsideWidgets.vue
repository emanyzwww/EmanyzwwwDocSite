<script setup lang="ts">
import { computed } from 'vue'

import { SITE } from '../../../data/site'
import ProfileCard from './ProfileCard.vue'
import TagsCard from './TagsCard.vue'

/**
 * 侧栏容器：按 `data/site.ts` 里 `widgets` 的顺序渲染卡片。
 *
 * 加/删/调序只改数据文件中的 `widgets` 数组，组件这里不需要改；
 * 新增一种卡片时才需要在下面的 REGISTRY 里登记一次。
 */

/** 侧栏组件名 → 组件。 */
const REGISTRY = {
  profile: ProfileCard,
  tags: TagsCard,
} as const

const cards = computed(() => SITE.widgets.map((name) => ({ name, component: REGISTRY[name] })))
</script>

<template>
  <component :is="card.component" v-for="card in cards" :key="card.name" />
</template>
