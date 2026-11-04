<script setup lang="ts">
import { SITE } from '../../../data/site'
import type { TagSummary } from '../../../types'
import { useI18n } from '../../i18n'
import { href } from '../../support/paths'

/**
 * 标签分组列表（标签总览页）。
 *
 * 每个标签一张小卡：标签名 + 数量 + 该标签下最近几篇文章；
 * 文章数超过预览条数时给一个「查看全部」入口。
 */

defineProps<{ tags: TagSummary[] }>()

const { m } = useI18n()
</script>

<template>
  <div v-if="tags.length" class="tag-groups">
    <section v-for="tag in tags" :key="tag.slug" class="tag-group">
      <header class="tag-group__head">
        <a class="tag-group__name" :href="href(tag.url)">{{ tag.label }}</a>
        <span class="tag-group__count">{{ tag.count }}</span>
      </header>

      <ul class="tag-group__posts">
        <li v-for="post in tag.posts.slice(0, SITE.tagPreviewCount)" :key="post.url">
          <a :href="href(post.url)">{{ post.title }}</a>
          <!--
            用 `dateText`（2026 年 10 月 19 日 / Oct 19, 2026），不是 `isoDate`。
            同一个站里日期有三种写法曾是审计里的确凿问题：原始 ISO 只适合
            放进 `datetime` 属性给机器读，读者看的必须是本地化文本。
          -->
          <time :datetime="post.isoDate">{{ post.dateText }}</time>
        </li>
      </ul>

      <a v-if="tag.count > SITE.tagPreviewCount" class="tag-group__more" :href="href(tag.url)">
        {{ m.allPosts }}
      </a>
    </section>
  </div>
</template>
