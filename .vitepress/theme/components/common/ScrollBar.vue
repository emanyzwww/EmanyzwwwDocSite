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
 * ---------- 自动隐藏 ----------
 *
 * 默认**隐藏**，三种情况下出现：正在滚动、指针靠近右侧边缘、正在拖拽。
 * 停止滚动 1.2 秒后淡出。
 *
 * 为什么必须隐藏：页面只比视口高一点时，拇指按比例会占掉轨道的大半。
 * 实测（1440×900）内容 1070px 时拇指长 702px = 轨道的 84% ——
 * 一根几乎和视口等高的灰条常驻右边，视觉重量远超它表达的信息。
 * macOS 的覆盖式滚动条是同样的取舍。
 *
 * 为什么还要「指针靠近就显示」：隐藏之后「拖拇指跳转」就没有可见入口了。
 * 鼠标移向右边缘 24px 时它必须出现 —— 那正是这个操作的前兆动作。
 *
 * ---------- 只有拇指是可交互的 ----------
 *
 * 轨道（含槽底）`pointer-events: none`，透明且不拦截点击；
 * 只有拇指 `pointer-events: auto`（且仅在显示状态下）。
 * 所以它在页面上「只是被看见」，不会挡住正文里的链接。
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

const { thumb, top, visible, shown, active, startDrag, setHover, refresh } =
  useScrollBar(headerElement)

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
  <!--
    `is-shown` 控制透明度与可交互性，`v-show` 控制是否存在。

    两层是分开的：`visible`（有内容可滚）为假时元素根本不该在树上；
    `shown`（自动隐藏状态）为假时元素在、但透明且 `pointer-events: none`。
    这样淡入淡出有过渡可做，而不可滚的页面不会有残留的透明元素。
  -->
  <div class="scrollbar" :class="{ 'is-active': active, 'is-shown': shown }" aria-hidden="true">
    <div
      v-show="visible"
      class="scrollbar__thumb"
      :style="style"
      @pointerdown="startDrag"
      @pointerenter="setHover(true)"
      @pointerleave="setHover(false)" />
  </div>
</template>
