<script setup lang="ts">
import type { TagSummary } from '../../../types'
import { useI18n } from '../../i18n'
import { href } from '../../support/paths'

/**
 * 标签分组列表（标签总览页）。
 *
 * 每个标签一张小卡：标签名 + 数量 + 该标签下最近 3 篇文章；
 * 文章数超过 3 时给一个「查看全部」入口。
 */

defineProps<{ tags: TagSummary[] }>()

const { m } = useI18n()

/** 每个标签下最多列几篇（超出时给「查看全部」）。 */
const PREVIEW_COUNT = 3
</script>

<template>
  <div v-if="tags.length" class="tag-groups">
    <section v-for="tag in tags" :key="tag.slug" class="tag-group">
      <header class="tag-group__head">
        <a class="tag-group__name" :href="href(tag.url)">{{ tag.label }}</a>
        <span class="tag-group__count">{{ tag.count }}</span>
      </header>

      <ul class="tag-group__posts">
        <li v-for="post in tag.posts.slice(0, PREVIEW_COUNT)" :key="post.url">
          <a :href="href(post.url)">{{ post.title }}</a>
          <time :datetime="post.isoDate">{{ post.isoDate }}</time>
        </li>
      </ul>

      <a v-if="tag.count > PREVIEW_COUNT" class="tag-group__more" :href="href(tag.url)">
        {{ m.allPosts }}
      </a>
    </section>
  </div>
</template>
