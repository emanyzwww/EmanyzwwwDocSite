<script setup lang="ts">
import { computed } from 'vue'

import { data as profile } from '../../../data/profile.data'
import { SITE } from '../../../data/site'
import { resolveMedia } from '../../support/media'
import { href, isExternal } from '../../support/paths'
import AppIcon from '../common/AppIcon.vue'

/**
 * 个人资料卡。
 *
 * 数据来自 `data/profile.ts`；`bio` 已在构建期渲染为 HTML（`profile.data.ts`），
 * 头像通过 `docs/media/` 的资源导入拿到带指纹的地址。
 */

const avatar = computed(() => resolveMedia(profile.avatar))
const displayName = computed(() => profile.name || SITE.name)
</script>

<template>
  <section class="card profile">
    <div v-if="avatar" class="profile__avatar">
      <img :src="avatar" :alt="displayName" loading="lazy" width="80" height="80" />
    </div>

    <h2 class="profile__name">{{ displayName }}</h2>
    <p v-if="profile.tagline" class="profile__tagline">{{ profile.tagline }}</p>

    <!-- eslint-disable-next-line vue/no-v-html — 内容来自本地 profile.ts，构建期渲染 -->
    <div v-if="profile.bioHtml" class="profile__bio" v-html="profile.bioHtml" />

    <ul v-if="profile.links.length" class="profile__links">
      <li v-for="link in profile.links" :key="link.url">
        <a
          :href="href(link.url)"
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
