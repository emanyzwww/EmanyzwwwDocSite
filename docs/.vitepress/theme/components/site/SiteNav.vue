<script setup lang="ts">
import { useRoute } from 'vitepress'
import { computed } from 'vue'

import { NAV } from '../../../data/site'
import { useI18n } from '../../i18n'
import { href } from '../../support/paths'

/**
 * 顶部导航。
 *
 * 导航项来自 `data/site.ts`（不是 VitePress 的 themeConfig.nav），
 * 因为本站的导航与语言、目录结构强相关，集中在一处更好维护。
 *
 * 高亮规则：当前路径等于该项，或位于该项目录下（`/posts/x/` 命中 `/posts/`）。
 * 首页只做精确匹配，否则任何页面都会命中 `/`。
 */

const route = useRoute()
const { locale, m } = useI18n()

const items = computed(() => NAV[locale.value])

function isActive(link: string): boolean {
  const path = route.path
  if (link === '/' || link === '/en/') return path === link
  const normalized = link.endsWith('/') ? link : `${link}/`
  return path === normalized || path.startsWith(normalized)
}
</script>

<template>
  <nav :aria-label="m.mainNav">
    <ul class="site-nav">
      <li v-for="item in items" :key="item.link">
        <a :href="href(item.link)" :aria-current="isActive(item.link) ? 'page' : undefined">
          {{ item.text }}
        </a>
      </li>
    </ul>
  </nav>
</template>
