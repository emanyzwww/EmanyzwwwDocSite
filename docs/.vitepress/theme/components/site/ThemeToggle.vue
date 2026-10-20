<script setup lang="ts">
/**
 * 主题切换。
 *
 * 复用 VitePress 的 `isDark`：它自带「首屏无闪烁」的初始化脚本
 * （在 `<head>` 里读 localStorage，早于应用挂载执行），
 * 也自带跟随系统 + 手动覆盖的语义，因此这里不再自己写 30 行初始化。
 */
import { computed } from 'vue'

import { useData } from 'vitepress'

import AppIcon from '../common/AppIcon.vue'
import { useI18n } from '../../i18n'

const { isDark } = useData()
const { m } = useI18n()

const label = computed(() => m.value.toggleTheme)

function toggle(): void {
  isDark.value = !isDark.value
}
</script>

<template>
  <button
    class="theme-toggle icon-button"
    type="button"
    data-theme-toggle
    :aria-label="label"
    :title="label"
    :aria-pressed="isDark ? 'true' : 'false'"
    @click="toggle"
  >
    <AppIcon name="sun" extra-class="icon-sun" />
    <AppIcon name="moon" extra-class="icon-moon" />
  </button>
</template>
