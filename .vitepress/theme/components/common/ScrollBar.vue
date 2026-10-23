<script setup lang="ts">
import { useRoute } from 'vitepress'
import { computed, nextTick, watch } from 'vue'

import { useScrollBar } from '../../composables/useScrollBar'

/**
 * 自绘滚动条（文档级）。
 *
 * 替代系统原生滚动条。原生条在这个站上有四个解决不了的问题，
 * 也正是用户提的五条要求（详见 `composables/useScrollBar.ts` 顶部说明）：
 *
 * 1. 长度不可控 —— 长文章里会细成一条缝，几乎抓不住；
 * 2. 只能贴视口上下沿 —— 滚到顶部时被粘性页头压住；
 * 3. 槽底色无法与画布完全一致 —— 始终是一根「系统条」；
 * 4. 层级固定在内容之上 —— 无法排到页头之下。
 *
 * ---------- 与页头的关系（用户要求的层级） ----------
 *
 * 「在内容上、在页头下」：`z-index: var(--z-scrollbar)`（90），
 * 夹在正文（0）与页头（100）之间。
 *
 * 这里**不能**像阅读进度条那样挂在 `<header>` 内部：
 * 页头的 `backdrop-filter` 会为 `position: fixed` 后代创建包含块，
 * 把滚动条关进页头的层叠上下文里 —— 那样它的 `z-index` 就只跟页头的
 * 子元素比较，与页面内容无关了。所以它挂在 `PageShell`，与页头平级。
 *
 * 轨道上沿**按页头实测下沿**起算（不写死 `--header-height`），
 * 同时把拇指长度下限设为页头高度：短页里拇指也不会退化成一条缝，
 * 任何页面上都有同一个视觉重量，且永远不会有任何一截被页头压住。
 *
 * ---------- 只有拇指是可交互的 ----------
 *
 * 轨道（含槽底）`pointer-events: none`，透明且不拦截点击；
 * 只有拇指 `pointer-events: auto`。所以它在页面上「只是被看见」，
 * 不会挡住正文里的链接。
 */

const props = withDefaults(
  defineProps<{
    /** 页头选择器：轨道从它的下沿开始。 */
    headerSelector?: string
  }>(),
  { headerSelector: '.site-header' },
)

/**
 * 页头元素（缓存）。
 *
 * 每帧都 `querySelector` 是浪费，而页头由 `PageShell` 常驻、
 * 路由切换不会重建，所以只查一次就够；查不到（极早期）时下次再试。
 */
let header: HTMLElement | null = null

function headerElement(): HTMLElement | null {
  header ??= document.querySelector<HTMLElement>(props.headerSelector)
  return header
}

const { thumb, top, visible, active, startDrag, setHover, refresh } = useScrollBar(headerElement)

const route = useRoute()

/**
 * 路由切换后重测。
 *
 * 这个组件挂在常驻的 `PageShell` 上，**不会**随路由重建，所以它必须自己
 * 知道「页面换了一篇」。否则从长文章跳到首页时，`scrollY` 一直是 0、
 * 没有任何 scroll 事件，拇指会留在屏上指示一个已经不存在的位置。
 *
 * `nextTick` 是必要的：新页面的正文要等渲染完，`scrollHeight` 才是新值。
 */
watch(
  () => route.path,
  () => {
    nextTick(() => {
      // 页头可能在新页面重建过，清掉缓存的引用
      header = null
      refresh()
    })
  },
)

const style = computed(() => ({
  height: `${thumb.value.length}px`,
  transform: `translateY(${top.value}px)`,
}))
</script>

<template>
  <div class="scrollbar" :class="{ 'is-active': active }" aria-hidden="true">
    <div
      v-show="visible"
      class="scrollbar__thumb"
      :style="style"
      @pointerdown="startDrag"
      @pointerenter="setHover(true)"
      @pointerleave="setHover(false)" />
  </div>
</template>
