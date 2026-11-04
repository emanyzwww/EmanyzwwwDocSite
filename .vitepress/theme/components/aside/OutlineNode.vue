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
      `title` 补全被两行截断的超长标题（见 posts.css 的 `.toc__list a`）：
      目录项最多两行，再长的部分用 `-webkit-line-clamp` 收掉，悬停仍能看到全文。
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
