<script setup lang="ts">
import { useData } from 'vitepress'
import { computed } from 'vue'

import { useI18n } from '../../i18n'
import { startThemeTransition } from '../../support/theme-transition'
import AppIcon from '../common/AppIcon.vue'

/**
 * 主题切换。
 *
 * 复用 VitePress 的 `isDark`：它自带「首屏无闪烁」的初始化脚本
 * （在 `<head>` 里读 localStorage，早于应用挂载执行），
 * 也自带跟随系统 + 手动覆盖的语义，因此这里不再自己写 30 行初始化。
 *
 * ---------- 切换本身有过渡 ----------
 *
 * 改造前只有 `body` 的 `background-color` 有 200ms 过渡，
 * 页头、卡片、侧栏、代码块全是瞬变 —— 切主题时只有画布在慢慢变，
 * 其余元素"啪"地同时换掉，观感像是**页面被换了一张**而不是**主题变了**。
 *
 * 现在用 View Transitions 对整屏做一次交叉淡入（见 support/theme-transition.ts）。
 * 为什么不给每个组件都加 `transition: background-color`：
 * 那需要把 `background`/`color`/`border-color` 挂到几乎所有选择器上，
 * 常驻的过渡会让**滚动、悬停、翻页**都变慢（任何颜色变化都会走 200ms），
 * 而读者只想要"切换的那一刻"有过渡。
 */

const { isDark } = useData()
const { m } = useI18n()

const label = computed(() => m.value.toggleTheme)

/**
 * 切换主题。
 *
 * `startThemeTransition` 会在支持 View Transitions 且未要求减少动效时
 * 把 `isDark` 的翻转包在一次交叉淡入里；否则**同步执行**，
 * 行为与改造前完全一致（不支持时不会有任何功能损失）。
 */
function toggle(): void {
  const next = !isDark.value
  startThemeTransition(() => {
    isDark.value = next
  })
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
    @click="toggle">
    <AppIcon name="sun" extra-class="icon-sun" />
    <AppIcon name="moon" extra-class="icon-moon" />
  </button>
</template>
