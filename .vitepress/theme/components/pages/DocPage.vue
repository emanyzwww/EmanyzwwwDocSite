<script setup lang="ts">
import { useData, withBase } from 'vitepress'
import { computed } from 'vue'

import { SITE } from '../../../data/site'
import { useCurrentPost } from '../../composables/useCurrentPost'
import { useLocaleSwitch } from '../../composables/useLocaleSwitch'
import { format, useI18n } from '../../i18n'
import { feedPath, href, localizedHref, postListPath } from '../../support/paths'
import OutlineCard from '../aside/OutlineCard.vue'
import StatsCard from '../aside/StatsCard.vue'
import AppIcon from '../common/AppIcon.vue'
import ThreeColumn from '../layout/ThreeColumn.vue'
import PostActions from '../post/PostActions.vue'
import PostMeta from '../post/PostMeta.vue'
import PostNav from '../post/PostNav.vue'

/**
 * 文档 / 文章页（默认布局）。
 *
 * 判断「是不是文章」不靠路径判断，而是看构建期的文章数据里能否匹配到当前页，
 * 因此把一篇文章放到 `docs/<locale>/<YYYYMM>/<DDNN>/index.md` 并写 `date`，
 * 就会自动获得文章的全部行为（元信息、导语、返回列表、上下篇、进度条、
 * 文末动作条）。草稿（`draft: true`）走同一套版面，只多一枚「草稿」徽章。
 */

const { frontmatter, page } = useData()
const { locale, m } = useI18n()
const { current } = useCurrentPost()
const { translations } = useLocaleSwitch()

/** 是否为一篇文章：能匹配到构建期文章数据即为文章（含草稿）。 */
const isPost = computed(() => current.value !== undefined)

/** 页面标题（不含站点名）。 */
const heading = computed(() => page.value.title)

const description = computed(() => (frontmatter.value.description as string | undefined) ?? '')

/**
 * 导语。
 *
 * 只有「作者显式写了 description、且它与正文首段不同」时才有值
 * （构建期在 `toPostSummary` 里判断，见 `PostSummary.lead`）。
 */
const lead = computed(() => current.value?.lead ?? null)

/** 是否显示右栏目录：正文里至少有一个 H2/H3，且没被 frontmatter 关掉。 */
const hasOutline = computed(() => {
  if (frontmatter.value.outline === false || SITE.outline === false) return false
  return page.value.headers.some((header) => header.level === 2 || header.level === 3)
})

const backToPosts = computed(() => href(postListPath(locale.value)))
const feedUrl = computed(() => withBase(feedPath(locale.value)))
</script>

<template>
  <ThreeColumn>
    <!--
      进度条**不在这里**渲染。它已搬到 `SiteHeader` 内部（绝对定位贴页头下沿）：
      这样页头在移动端隐藏时进度条自动一起隐藏，也不会再因为
      `top: var(--header-height)` 与页头实际高度（含 1px 下边框）不一致
      而出现「没完全贴住」的观感。
    -->

    <article :data-article-body="isPost ? '' : undefined">
      <header class="post-header">
        <h1 class="page-title">{{ heading }}</h1>
        <p v-if="!isPost && description" class="page-description">{{ description }}</p>
        <PostMeta v-if="current" :post="current">
          <!--
            「另有 English 版」放在 meta 行尾：它是导航（不是文章事实），
            但必须和日期/标签在同一行——`.post-meta` 是 flex-wrap 的，
            窄屏会自动折到第二行。
          -->
          <a
            v-for="variant in translations"
            :key="variant.code"
            class="post-meta__item post-meta__alt"
            :href="localizedHref(variant.url)"
            :hreflang="variant.lang"
            :lang="variant.lang">
            <AppIcon name="globe" />
            {{ format(m.altLanguageVersion, { language: variant.label }) }}
          </a>
        </PostMeta>
        <p v-if="lead" class="post-header__lead">{{ lead }}</p>
      </header>

      <div class="prose">
        <Content />
      </div>

      <footer v-if="isPost" class="post-footer">
        <a class="btn" :href="backToPosts">{{ m.backToPosts }}</a>
        <div class="post-footer__actions">
          <PostActions />
          <a class="btn" :href="feedUrl">RSS</a>
        </div>
      </footer>
    </article>

    <PostNav v-if="isPost" />

    <template #aside>
      <OutlineCard v-if="hasOutline" />
      <StatsCard v-else />
    </template>
  </ThreeColumn>
</template>
