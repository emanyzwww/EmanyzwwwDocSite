<script setup lang="ts">
/**
 * 空状态。
 *
 * 统一「没有内容」的呈现，避免每个页面各写一段 `<p class="empty">`。
 */
defineProps<{ text: string }>()
</script>

<template>
  <p class="empty">{{ text }}</p>
</template>
