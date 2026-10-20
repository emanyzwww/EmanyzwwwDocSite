<script setup lang="ts">
/**
 * 阅读进度条。
 *
 * 挂在文章正文上方，按正文区域的滚动量计算进度。
 * 与旧站的区别：旧站只有 JS 而没有任何元素输出（进度条从未生效），
 * 这里「元素」和「计算」放在同一个组件里，不会再断链。
 */
import { computed } from 'vue'

import { useReadingProgress } from '../../composables/useReadingProgress'

const props = defineProps<{
  /** 需要测量进度的元素选择器。 */
  selector: string
}>()

const { progress } = useReadingProgress(() => document.querySelector(props.selector))

const style = computed(() => ({ transform: `scaleX(${progress.value})` }))
</script>

<template>
  <div class="reading-progress" aria-hidden="true">
    <div class="reading-progress__bar" :style="style" />
  </div>
</template>
