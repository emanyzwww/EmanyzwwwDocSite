<script setup lang="ts">
import AsideWidgets from '../aside/AsideWidgets.vue'

/**
 * 两栏布局：左侧栏 + 主内容。
 *
 * 首页、文章列表、普通页面都用它。
 * 之所以不用三栏：目录只在文章页有意义，其他页面右栏留白反而更空。
 */
</script>

<template>
  <div class="container">
    <div class="layout">
      <aside class="layout__aside">
        <AsideWidgets />
      </aside>

      <div class="layout__main">
        <slot />
      </div>
    </div>
  </div>
</template>
