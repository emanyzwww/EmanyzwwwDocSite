<script setup lang="ts">
import { useRoute } from 'vitepress'
import { computed } from 'vue'

import { NAV } from '../../../data/site'
import { isArticleUrlPath } from '../../../support/article-path'
import { useI18n } from '../../i18n'
import { href, postListPath, stripLocale, stripRouteBase } from '../../support/paths'

/**
 * 顶部导航。
 *
 * 导航项来自 `data/site.ts`（不是 VitePress 的 themeConfig.nav），
 * 因为本站的导航与语言、目录结构强相关，集中在一处更好维护。
 *
 * 高亮规则：
 * - 首页只做精确匹配，否则任何页面都会命中 `/zh-cn/`；
 * - 其它项：当前路径等于该项，或位于该项目录下（`/zh-cn/pages/posts/page/2/`
 *   命中 `/zh-cn/pages/posts/`）；
 * - **文章页特判**：文章 URL 是 `/<locale>/<YYYYMM>/<DDNN>/<slug>/`，
 *   不在 `/pages/posts/` 目录下，但语义上属于「文章」栏目。
 */

const route = useRoute()
const { locale, m } = useI18n()

const items = computed(() => NAV[locale.value])

/** 首页地址：`/zh-cn/`、`/en/`，需要精确匹配。 */
const homeLink = computed(() => `/${locale.value}/`)

function isActive(link: string): boolean {
  /*
   * 必须先剥掉部署 base：`route.path` 是含 base 的（`/repo/zh-cn/pages/posts/`），
   * 而 `item.link` 是不含 base 的站点路径（`/zh-cn/pages/posts/`）。
   * 不剥的话两者永不相等，`aria-current="page"` 永远不会输出，
   * CSS 里那条 `.site-nav a[aria-current='page']` 高亮规则就等于不存在。
   */
  const path = stripRouteBase(route.path)
  if (link === homeLink.value) return path === link

  const normalized = link.endsWith('/') ? link : `${link}/`
  if (path === normalized || path.startsWith(normalized)) return true

  // 文章页：URL 不在列表页目录下，但同属「文章」栏目
  return link === postListPath(locale.value) && isArticleUrlPath(stripLocale(path))
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
