<script setup lang="ts">
/**
 * 自定义侧栏卡片。
 *
 * 内容来自 `data/widgets.ts`（已过滤 `enabled: false`，并在构建期渲染成 HTML）。
 * 想加一张卡片：改数据文件即可，不需要碰组件。
 */
import { data as widgets } from '../../../data/widgets.data'
</script>

<template>
  <section v-for="(widget, index) in widgets" :id="widget.id" :key="widget.id ?? index" class="card">
    <p v-if="widget.title" class="card__title">{{ widget.title }}</p>
    <!-- eslint-disable-next-line vue/no-v-html — 内容来自本地 widgets.ts，构建期渲染 -->
    <div class="widget__body widget__prose" v-html="widget.html" />
  </section>
</template>
