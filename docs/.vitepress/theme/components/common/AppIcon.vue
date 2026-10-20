<script setup lang="ts">
/**
 * 图标组件。
 *
 * 用法：`<AppIcon name="github" />`
 * 尺寸由 CSS 决定（`.icon` 默认 1em），颜色跟随 `currentColor`，
 * 因此明暗主题与悬停态都不需要额外处理。
 */
import { computed } from 'vue'

import type { IconName } from '../../../types'
import { getIcon, STROKE_WIDTH } from '../../support/icons'

const props = withDefaults(
  defineProps<{
    /** 图标名。 */
    name: IconName
    /** 追加的 class（如 `icon-sun`）。 */
    extraClass?: string
  }>(),
  { extraClass: '' },
)

const icon = computed(() => getIcon(props.name))
const strokeWidth = computed(() => icon.value.strokeWidth ?? STROKE_WIDTH)
</script>

<template>
  <svg
    class="icon"
    :class="props.extraClass"
    :viewBox="icon.viewBox"
    :fill="icon.mode === 'fill' ? 'currentColor' : 'none'"
    :stroke="icon.mode === 'stroke' ? 'currentColor' : undefined"
    :stroke-width="icon.mode === 'stroke' ? strokeWidth : undefined"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
    v-html="icon.body"
  />
</template>
