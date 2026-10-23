<script setup lang="ts">
import { computed } from 'vue'

import { data as profile } from '../../../data/profile.data'
import { SITE } from '../../../data/site'
import { useI18n } from '../../i18n'
import { resolveMedia } from '../../support/media'
import { feedPath, href, isExternal } from '../../support/paths'
import AppIcon from '../common/AppIcon.vue'

/**
 * 个人资料卡。
 *
 * 数据来自 `data/profile.ts`；`bio` 已在构建期渲染为 HTML（`profile.data.ts`），
 * 头像通过 `media/` 的资源导入拿到带指纹的地址。
 */

const { locale } = useI18n()

const avatar = computed(() => resolveMedia(profile.avatar))
const displayName = computed(() => profile.name || SITE.name)

/**
 * 链接地址本地化。
 *
 * `profile.ts` 是一份中英共用的配置，写不出「当前语言」，因此约定：
 * RSS 这类跟语言相关的地址统一写占位值 `/index.xml`，渲染时替换成
 * 当前语言的 feed（`/zh-cn/index.xml`、`/en/index.xml`）。
 */
function resolveLink(url: string): string {
  return href(url === '/index.xml' ? feedPath(locale.value) : url)
}
</script>

<template>
  <section class="card profile">
    <!--
      这里**不用** loading="lazy"：头像是侧栏首屏元素，懒加载反而会推迟
      它的解码时机（LCP 候选之一），与「优化首屏」的目的相反。
      用 decoding="async" 让解码不阻塞渲染即可。
    -->
    <div v-if="avatar" class="profile__avatar">
      <img
        :src="avatar"
        :alt="displayName"
        width="80"
        height="80"
        decoding="async"
        fetchpriority="low" />
    </div>

    <!--
      用 `<p>` 而不是 `<h2>`：侧栏在 DOM 里排在 `<main>` 之前，
      用 h2 会让每一页的大纲都从「Emanyzwww」这个侧栏标题开始，
      正文的真正 h1 反而被埋在后面（读屏的「按标题导航」会先读到人名）。
      人名不是页面结构的标题，只是卡片里的标识。
    -->
    <p class="profile__name">{{ displayName }}</p>
    <p v-if="profile.tagline" class="profile__tagline">{{ profile.tagline }}</p>

    <!-- eslint-disable-next-line vue/no-v-html — 内容来自本地 profile.ts，构建期渲染 -->
    <div v-if="profile.bioHtml" class="profile__bio" v-html="profile.bioHtml" />

    <ul v-if="profile.links.length" class="profile__links">
      <li v-for="link in profile.links" :key="link.url">
        <a
          :href="resolveLink(link.url)"
          :title="link.label"
          :aria-label="link.label"
          :target="isExternal(link.url) ? '_blank' : undefined"
          :rel="isExternal(link.url) ? 'noopener noreferrer' : undefined">
          <AppIcon :name="link.icon ?? 'link'" />
        </a>
      </li>
    </ul>
  </section>
</template>
