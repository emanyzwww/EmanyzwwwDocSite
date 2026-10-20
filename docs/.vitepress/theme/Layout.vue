<script setup lang="ts">
/**
 * 路由分发。
 *
 * `frontmatter.layout` 决定用哪个页面组件：
 * - `home`  首页（首页文字 + 最近文章）
 * - `posts` 文章列表（时间线 + 分页）
 * - `tags`  标签总览（标签云 + 分组）
 * - `tag`   标签详情（动态路由生成）
 * - 其他    文档页（文章与普通页共用）
 *
 * 与 Hugo 的模板查找相比，这里的映射是**显式**的：
 * 看 Markdown 的 frontmatter 就知道会用哪个组件，不需要记模板优先级。
 *
 * 页头 / 页脚 / 跳转链接由外壳统一提供，各页面只关心内容本身。
 */
import { computed } from 'vue'

import { useData } from 'vitepress'

import DocPage from './components/pages/DocPage.vue'
import HomePage from './components/pages/HomePage.vue'
import NotFoundPage from './components/pages/NotFoundPage.vue'
import PostsPage from './components/pages/PostsPage.vue'
import TagPage from './components/pages/TagPage.vue'
import TagsPage from './components/pages/TagsPage.vue'
import PageShell from './components/layout/PageShell.vue'

const { frontmatter, page } = useData()

const view = computed(() => {
  if (page.value.isNotFound) return NotFoundPage

  switch (frontmatter.value.layout) {
    case 'home':
      return HomePage
    case 'posts':
      return PostsPage
    case 'tags':
      return TagsPage
    case 'tag':
      return TagPage
    default:
      return DocPage
  }
})
</script>

<template>
  <PageShell>
    <component :is="view" />
  </PageShell>
</template>
