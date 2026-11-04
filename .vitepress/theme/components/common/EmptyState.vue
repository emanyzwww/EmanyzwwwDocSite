<script setup lang="ts">
import type { IconName } from '../../../types'
import AppIcon from './AppIcon.vue'

/**
 * 空状态。
 *
 * 统一「没有内容」的呈现，避免每个页面各写一段空态 HTML。
 * 形态与 404 页同族：一个弱化的图标 + 一句说明（+ 可选出口），
 * 而不是孤零零一行小字——空态是页面的**最终状态**，不是脚注。
 *
 * `action` 只在「别处有内容可去」时传（标签下无文章、全站无标签），
 * 首页/列表页本身就是终点，不额外给按钮。
 */
withDefaults(
  defineProps<{
    text: string
    icon?: IconName
    action?: { label: string; href: string }
  }>(),
  { icon: 'list' },
)
</script>

<template>
  <div class="empty">
    <AppIcon :name="icon" extra-class="empty__icon" />
    <p class="empty__text">{{ text }}</p>
    <a v-if="action" class="btn empty__action" :href="action.href">{{ action.label }}</a>
  </div>
</template>
