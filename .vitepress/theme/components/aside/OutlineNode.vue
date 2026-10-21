<script setup lang="ts">
import type { OutlineItem } from '../../../types'

/**
 * 目录里的一个节点（递归组件）。
 *
 * 用递归而不是写死两级：正文可能出现 H2 → H3 → H4，
 * 写死两级时 H4 会被整段丢掉。层级深度由数据决定，模板不需要跟着改。
 *
 * 缩进由 CSS 按嵌套层数自动递增（见 posts.css 的 `.toc__list ul`），
 * 因此这里不需要为每一级单独传缩进参数。
 */

defineOptions({ name: 'OutlineNode' })

defineProps<{
  node: OutlineItem
  /** 当前高亮的锚点 id。 */
  activeId: string
}>()
</script>

<template>
  <li>
    <!--
      `title` 用来补全被 CSS 省略号截断的长标题：
      目录项固定单行（见 posts.css），悬停时仍能看到完整文字。
    -->
    <a
      :href="`#${node.slug}`"
      :title="node.title"
      :class="{ 'is-active': activeId === node.slug }"
      :aria-current="activeId === node.slug ? 'true' : undefined">
      {{ node.title }}
    </a>
    <ul v-if="node.children.length">
      <OutlineNode
        v-for="child in node.children"
        :key="child.slug"
        :node="child"
        :active-id="activeId" />
    </ul>
  </li>
</template>
