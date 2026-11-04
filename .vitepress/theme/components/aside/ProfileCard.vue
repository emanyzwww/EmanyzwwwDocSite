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
 * 当前语言的资料文案（tagline / 已渲染的 bio）。
 *
 * 构建期每种语言各渲染一份（见 `profile.data.ts`）——个人资料是站点级常量，
 * 数据加载器拿不到页面语言，只能把各语言都准备好、这里按 locale 挑。
 */
const copy = computed(() => profile.i18n[locale.value] ?? profile.i18n['zh-cn'])

/** 图标链接的可读名：优先当前语言（`邮箱` / `Email`）。 */
function linkLabel(link: (typeof profile.links)[number]): string {
  return link.labelI18n?.[locale.value] ?? link.label
}

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
    <p v-if="copy.tagline" class="profile__tagline">{{ copy.tagline }}</p>

    <!-- eslint-disable-next-line vue/no-v-html — 内容来自本地 profile.ts，构建期渲染 -->
    <div v-if="copy.bioHtml" class="profile__bio" v-html="copy.bioHtml" />

    <ul v-if="profile.links.length" class="profile__links">
      <li v-for="link in profile.links" :key="link.url">
        <a
          :href="resolveLink(link.url)"
          :title="linkLabel(link)"
          :aria-label="linkLabel(link)"
          :target="isExternal(link.url) ? '_blank' : undefined"
          :rel="isExternal(link.url) ? 'noopener noreferrer' : undefined">
          <AppIcon :name="link.icon ?? 'link'" />
        </a>
      </li>
    </ul>
  </section>
</template>
