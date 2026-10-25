<script setup lang="ts">
import { useData } from 'vitepress'
import { computed } from 'vue'

import type { OutlineItem } from '../../../types'
import { useActiveAnchor } from '../../composables/useActiveAnchor'
import { useI18n } from '../../i18n'
import AppIcon from '../common/AppIcon.vue'
import OutlineNode from './OutlineNode.vue'

/**
 * 目录卡（右栏）。
 *
 * 目录来源是 VitePress 在构建期解析出的 `page.headers`，
 * 不需要再读一遍 Markdown；高亮由 `useActiveAnchor` 通过滚动位置驱动。
 *
 * 与旧站的差异：
 * - 旧站把 HTML 字符串塞进 `v-html`，无法做无障碍处理；
 * - 这里渲染成真正的 `<ul>`，并给当前项加 `aria-current="true"`。
 */

const { page } = useData()
const { m } = useI18n()
const { activeId } = useActiveAnchor()

/**
 * 目录树。
 *
 * `page.headers` **本身就已经是嵌套结构**（VitePress 按 heading 级别建好了
 * `children`），所以这里只做一层「裁剪 + 归一化」，不要再用栈去重建树——
 * 之前就是把它当成扁平数组处理，结果只剩 4 个顶层 H2，H3/H4 全丢了。
 */
function toItem(header: {
  level: number
  title: string
  slug: string
  children?: unknown[]
}): OutlineItem {
  return {
    title: header.title,
    slug: header.slug,
    level: header.level,
    children: (header.children ?? []).map((child) =>
      toItem(child as { level: number; title: string; slug: string; children?: unknown[] }),
    ),
  }
}

const tree = computed<OutlineItem[]>(() => page.value.headers.map(toItem))

const hasOutline = computed(() => tree.value.length > 0)
</script>

<template>
  <div v-if="hasOutline" class="card toc">
    <p class="toc__title">
      <AppIcon name="list" />
      {{ m.onThisPage }}
    </p>
    <!--
      `vp-raw` 是 VitePress 路由委托的豁免类（router.js 对 closest('.vp-raw')
      的链接直接放行）：目录/标题锚点必须由 `support/anchor-scroll.ts` **独家**
      接管 —— VitePress 自己的 scrollTo() 会排在 rAF 里做一次无法取消的
      window.scrollTo(0, y)，移动端浮层还开着时那次滚动会先跳走、锁释放后
      又被还原，正是「先抽搐再平滑跳过去」的直因。见 anchor-scroll.ts 顶注。
    -->
    <ul class="toc__list vp-raw">
      <OutlineNode v-for="node in tree" :key="node.slug" :node="node" :active-id="activeId" />
    </ul>
  </div>
</template>
