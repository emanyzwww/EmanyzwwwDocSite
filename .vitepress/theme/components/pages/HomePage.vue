<script setup lang="ts">
import { useData } from 'vitepress'
import { computed } from 'vue'

import { SITE } from '../../../data/site'
import { usePosts } from '../../composables/usePosts'
import { useI18n } from '../../i18n'
import { href, postListPath } from '../../support/paths'
import AppIcon from '../common/AppIcon.vue'
import EmptyState from '../common/EmptyState.vue'
import TwoColumn from '../layout/TwoColumn.vue'
import PostCard from '../post/PostCard.vue'

/**
 * 首页（`frontmatter.layout: home`）。
 *
 * 结构：页面标题 + 正文 + 最近若干篇文章卡片 + 「查看全部文章」入口。
 * 文章条数与列表地址分别来自 `data/site.ts` 与 `support/paths.ts`。
 *
 * 标题取 `page.title`（frontmatter 里的标题），不用 `useData().title`
 * ——后者会拼上站点名，用于 `<title>` 合适，用于页面大标题就重复了。
 */

const { page, frontmatter } = useData()
const { locale, m } = useI18n()
const { posts } = usePosts()

const heading = computed(() => page.value.title || SITE.name)
const recent = computed(() => posts.value.slice(0, SITE.homePostCount))
const description = computed(() => (frontmatter.value.description as string | undefined) ?? '')
const allPostsUrl = computed(() => href(postListPath(locale.value)))
</script>

<template>
  <TwoColumn>
    <!--
      `page-header--hero`：首页标题走 44px 档位，其余页面 36px。

      首页是唯一需要「大气」的场合——它是访客的第一印象，且没有其他
      内容与标题竞争注意力。文章页/列表页的 h1 用 36px 就够，
      再大会压过正文。
    -->
    <header class="page-header page-header--hero">
      <h1 class="page-title">{{ heading }}</h1>
      <p v-if="description" class="page-description">{{ description }}</p>
    </header>

    <div class="prose">
      <Content />
    </div>

    <template v-if="recent.length">
      <div class="post-list">
        <PostCard v-for="post in recent" :key="post.url" :post="post" />
      </div>

      <div class="post-list__more">
        <a class="btn" :href="allPostsUrl">
          {{ m.allPosts }}
          <AppIcon name="arrow-right" />
        </a>
      </div>
    </template>

    <EmptyState v-else :text="m.noPostsYet" />
  </TwoColumn>
</template>
