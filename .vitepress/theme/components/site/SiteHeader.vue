<script setup lang="ts">
import { computed } from 'vue'

import { useCurrentPost } from '../../composables/useCurrentPost'
import { useDockState } from '../../composables/useDockState'
import ProgressBar from '../common/ProgressBar.vue'
import DesktopHeader from '../desktop/DesktopHeader.vue'
import MobileHeader from '../mobile/MobileHeader.vue'

/**
 * 页头框架（不是页头内容）。
 *
 * 只负责两件跨设备的事：
 * 1. `<header>` 这个单一地标与它的阅读态（`is-hidden`，位移样式只在移动端生效）；
 * 2. 阅读进度条 —— 它是页头的绝对定位子元素，跟着页头一起隐藏/出现。
 *
 * 内容按设备归属拆到两个组件里，两者**同时渲染**、由 CSS 媒体查询决定显示哪份：
 * - `desktop/DesktopHeader.vue`：品牌 + 横向导航 + 搜索入口 + 工具；
 * - `mobile/MobileHeader.vue`：品牌 + 汉堡 + 抽屉。
 *
 * 为什么不用 `v-if` 按设备二选一：静态站是 SSR + 水合，服务端不知道视口宽度，
 * 按设备条件渲染会让首屏结构与客户端不一致。两份 DOM 都留着、由媒体查询互斥，
 * 是目前唯一不需要在服务端猜设备的做法。
 *
 * 进度条为什么在页头**内部**：它要在移动端阅读态跟着页头一起滑走，
 * 又要在桌面端贴在页头下沿，所以它不是「页头的兄弟」，而是页头的一部分；
 * 用 `position: fixed` 的理由见 `posts.css` 的 `.reading-progress`。
 *
 * 历史上的真实 bug：`is-hidden` 曾在桌面端也被加上，而让它位移的 CSS 只在移动端
 * 媒体查询里，于是桌面端页头不动、进度条却被相邻选择器顶到屏幕顶端。
 * 进度条留在页头内部之后，这个组合不可能再出现。
 */

defineProps<{ searchOpen?: boolean }>()
const emit = defineEmits<{ (e: 'search'): void }>()

/** 本页是否有文章正文（决定是否渲染进度条）。判定口径与 `DocPage` 一致。 */
const { current } = useCurrentPost()
const isPost = computed(() => current.value !== undefined)

/** 阅读态：页头整体上移出屏（位移由 mobile.css 定义，宽屏无效果）。 */
const { mode } = useDockState()
const hidden = computed(() => mode.value === 'reading')
</script>

<template>
  <header class="site-header" :class="{ 'is-hidden': hidden }">
    <div class="container site-header__inner">
      <DesktopHeader :search-open="searchOpen" @search="emit('search')" />
      <MobileHeader />
    </div>

    <ProgressBar v-if="isPost" selector="[data-article-body]" />
  </header>
</template>
