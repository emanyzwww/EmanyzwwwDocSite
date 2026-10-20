<script setup lang="ts">
/**
 * 文档 / 文章页（默认布局）。
 *
 * 判断「是不是文章」不靠路径判断，而是看构建期的文章数据里能否匹配到当前页，
 * 因此把任何页面加进 `posts/` 并写 `date`，就会自动获得文章的全部行为
 * （元信息、返回列表、上下篇、进度条）。
 */
import { computed } from 'vue'

import { useData, withBase } from 'vitepress'

import { SITE } from '../../../data/site'
import { useCurrentPost } from '../../composables/useCurrentPost'
import { useI18n } from '../../i18n'
import { href, withLocale } from '../../support/paths'
import OutlineCard from '../aside/OutlineCard.vue'
import StatsCard from '../aside/StatsCard.vue'
import ProgressBar from '../common/ProgressBar.vue'
import ThreeColumn from '../layout/ThreeColumn.vue'
import PostMeta from '../post/PostMeta.vue'
import PostNav from '../post/PostNav.vue'

const { frontmatter, page } = useData()
const { locale, m } = useI18n()
const { current } = useCurrentPost()

/** 是否为一篇文章：能匹配到构建期文章数据即为文章。 */
const isPost = computed(() => current.value !== undefined)

/** 页面标题（不含站点名）。 */
const heading = computed(() => page.value.title)

const description = computed(() => (frontmatter.value.description as string | undefined) ?? '')

/** 是否显示右栏目录：正文里至少有一个 H2/H3，且没被 frontmatter 关掉。 */
const hasOutline = computed(() => {
  if (frontmatter.value.outline === false || SITE.outline === false) return false
  return page.value.headers.some((header) => header.level === 2 || header.level === 3)
})

const backToPosts = computed(() => href(withLocale('/posts/', locale.value)))
const feedUrl = computed(() => withBase(locale.value === 'en' ? '/en/index.xml' : '/index.xml'))
</script>

<template>
  <ThreeColumn>
    <ProgressBar v-if="isPost" selector="[data-article-body]" />

    <article :data-article-body="isPost ? '' : undefined">
      <header class="post-header">
        <h1 class="page-title">{{ heading }}</h1>
        <p v-if="!isPost && description" class="page-description">{{ description }}</p>
        <PostMeta v-if="current" :post="current" />
      </header>

      <div class="prose">
        <Content />
      </div>

      <footer v-if="isPost" class="post-footer">
        <a class="btn" :href="backToPosts">{{ m.backToPosts }}</a>
        <a class="btn" :href="feedUrl">RSS</a>
      </footer>
    </article>

    <PostNav v-if="isPost" />

    <template #aside>
      <OutlineCard v-if="hasOutline" />
      <StatsCard v-else />
    </template>
  </ThreeColumn>
</template>
