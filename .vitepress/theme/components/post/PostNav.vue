<script setup lang="ts">
import { useAdjacentPosts } from '../../composables/useAdjacentPosts'
import { useI18n } from '../../i18n'
import { href } from '../../support/paths'
import AppIcon from '../common/AppIcon.vue'

/**
 * 上一篇 / 下一篇。
 *
 * 顺序：更早的排在左边（上一篇），更新的排在右边（下一篇），
 * 与旧站 `PrevInSection` / `NextInSection` 一致。
 */

const { m } = useI18n()
const { previous, next } = useAdjacentPosts()
</script>

<template>
  <nav v-if="previous || next" class="post-nav" :aria-label="m.postNav">
    <a v-if="previous" class="post-nav__link" :href="href(previous.url)">
      <span class="post-nav__label">
        <AppIcon name="arrow-left" />
        {{ m.previousPost }}
      </span>
      <span class="post-nav__title">{{ previous.title }}</span>
    </a>
    <span v-else />

    <a v-if="next" class="post-nav__link post-nav__link--next" :href="href(next.url)">
      <span class="post-nav__label">
        {{ m.nextPost }}
        <AppIcon name="arrow-right" />
      </span>
      <span class="post-nav__title">{{ next.title }}</span>
    </a>
  </nav>
</template>
