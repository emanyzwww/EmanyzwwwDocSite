<script setup lang="ts">
/**
 * 三栏布局：左侧栏（卡片） + 主内容 + 右侧栏（目录 / 统计）。
 *
 * 文章页使用。窄屏下 CSS 会把两侧栏依次移到正文下方（见 layout.css）。
 */
import AsideWidgets from '../aside/AsideWidgets.vue'

defineSlots<{
  /** 主内容。 */
  default(): unknown
  /** 右侧栏内容。 */
  aside?(): unknown
}>()
</script>

<template>
  <div class="container">
    <div class="layout layout--three">
      <aside class="layout__aside layout__aside--left">
        <AsideWidgets />
      </aside>

      <div class="layout__main">
        <slot />
      </div>

      <aside class="layout__aside layout__aside--right">
        <slot name="aside" />
      </aside>
    </div>
  </div>
</template>
