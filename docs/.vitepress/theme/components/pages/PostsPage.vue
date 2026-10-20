<script setup lang="ts">
import { useData } from 'vitepress'
import { computed } from 'vue'

import { SITE } from '../../../data/site'
import { usePosts } from '../../composables/usePosts'
import { useI18n } from '../../i18n'
import { paginate } from '../../support/pagination'
import { postListUrl } from '../../support/paths'
import EmptyState from '../common/EmptyState.vue'
import TwoColumn from '../layout/TwoColumn.vue'
import Pagination from '../post/Pagination.vue'
import PostTimeline from '../post/PostTimeline.vue'

/**
 * 文章列表（`/posts/` 与 `/posts/page/N/`）。
 *
 * 分页由构建期生成的路由承担（见 `docs/posts/page/[page]/index.paths.ts`），
 * 因此这里没有任何客户端状态：页码来自路由参数。
 *
 * 标题取 frontmatter 里的 `title`（不含站点名），分页页码由组件拼上去，
 * 保证第 2 页显示「文章 · 2/3」而不是重复的「文章」。
 */

const { frontmatter, params } = useData()
const { locale, m } = useI18n()
const { posts } = usePosts()

/** 当前页码：分页页来自路由参数，列表首页固定为 1。 */
const currentPage = computed(() => Number(params.value?.page ?? 1) || 1)

const slice = computed(() => paginate(posts.value, currentPage.value, SITE.postsPerPage))

const baseTitle = computed(() => (frontmatter.value.title as string | undefined) ?? '')

const heading = computed(() =>
  slice.value.current > 1
    ? `${baseTitle.value} · ${slice.value.current}/${slice.value.totalPages}`
    : baseTitle.value,
)

const description = computed(() => (frontmatter.value.description as string | undefined) ?? '')

/** 页码 → 地址。第 1 页回到列表首页，避免出现 `/page/1/` 这类重复地址。 */
const urlOf = (page: number): string => postListUrl(locale.value, page)
</script>

<template>
  <TwoColumn>
    <header class="page-header">
      <h1 class="page-title">{{ heading }}</h1>
      <p v-if="description" class="page-description">{{ description }}</p>
    </header>

    <template v-if="slice.items.length">
      <PostTimeline :posts="slice.items" />
      <Pagination :current="slice.current" :total="slice.totalPages" :url-of="urlOf" />
    </template>

    <EmptyState v-else :text="m.noPostsYet" />
  </TwoColumn>
</template>
