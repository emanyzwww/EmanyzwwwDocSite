<script setup lang="ts">
import { useData } from 'vitepress'
import { computed } from 'vue'

import { useActiveAnchor } from '../../composables/useActiveAnchor'
import { useI18n } from '../../i18n'
import AppIcon from '../common/AppIcon.vue'

/**
 * 目录卡（右栏）。
 *
 * 目录来源是 VitePress 在构建期解析出的 `page.headers`，
 * 不需要再读一遍 Markdown；高亮由 `useActiveAnchor` 通过 IntersectionObserver 驱动。
 *
 * 与旧站的差异：
 * - 旧站把 HTML 字符串塞进 `v-html`，无法做无障碍处理；
 * - 这里渲染成真正的 `<ul>`，并给当前项加 `aria-current="true"`。
 */

const { page } = useData()
const { m } = useI18n()
const { activeId } = useActiveAnchor()

/** 目录里的一个节点。 */
interface OutlineNode {
  title: string
  slug: string
  children: OutlineNode[]
}

/**
 * 只取 H2/H3（与旧站 `startLevel = 2, endLevel = 3` 一致），并组装成两级树：
 * H3 挂到它上方最近的 H2 下；开头就出现的 H3 视为顶层节点。
 */
const tree = computed<OutlineNode[]>(() => {
  const nodes: OutlineNode[] = []
  let lastTopLevel: OutlineNode | null = null

  for (const header of page.value.headers) {
    if (header.level !== 2 && header.level !== 3) continue

    const node: OutlineNode = { title: header.title, slug: header.slug, children: [] }

    if (header.level === 2 || !lastTopLevel) {
      nodes.push(node)
      lastTopLevel = header.level === 2 ? node : lastTopLevel
    } else {
      lastTopLevel.children.push(node)
    }
  }

  return nodes
})

const hasOutline = computed(() => tree.value.length > 0)
</script>

<template>
  <div v-if="hasOutline" class="card toc">
    <p class="toc__title">
      <AppIcon name="list" />
      {{ m.onThisPage }}
    </p>
    <ul class="toc__list">
      <li v-for="node in tree" :key="node.slug">
        <a
          :href="`#${node.slug}`"
          :class="{ 'is-active': activeId === node.slug }"
          :aria-current="activeId === node.slug ? 'true' : undefined">
          {{ node.title }}
        </a>
        <ul v-if="node.children.length">
          <li v-for="child in node.children" :key="child.slug">
            <a
              :href="`#${child.slug}`"
              :class="{ 'is-active': activeId === child.slug }"
              :aria-current="activeId === child.slug ? 'true' : undefined">
              {{ child.title }}
            </a>
          </li>
        </ul>
      </li>
    </ul>
  </div>
</template>
