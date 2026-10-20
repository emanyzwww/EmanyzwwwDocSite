<script setup lang="ts">
import { computed } from 'vue'

import { SITE } from '../../../data/site'
import { usePosts } from '../../composables/usePosts'
import { useI18n } from '../../i18n'
import { href } from '../../support/paths'

/**
 * 侧栏最近文章卡。
 *
 * 数量默认取 `SITE.recentPostsLimit`，可在使用时通过 `limit` 覆盖。
 */

const props = withDefaults(defineProps<{ limit?: number }>(), {
  limit: () => SITE.recentPostsLimit,
})

const { m } = useI18n()
const { posts } = usePosts()

const recent = computed(() => posts.value.slice(0, props.limit))
</script>

<template>
  <section v-if="recent.length" class="card">
    <p class="card__title">{{ m.recentPosts }}</p>
    <ul class="mini-list">
      <li v-for="post in recent" :key="post.url">
        <a :href="href(post.url)">{{ post.title }}</a>
      </li>
    </ul>
  </section>
</template>
