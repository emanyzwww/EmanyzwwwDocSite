<script setup lang="ts">
/**
 * 侧栏链接卡：把个人资料里的社交链接以文字列表展示。
 *
 * 与「个人资料卡」底部的图标链接不重复——那是必选的图标入口，
 * 这张卡是可选组件（在 `data/site.ts` 的 `widgets` 里加 `'links'` 才出现）。
 */
import { computed } from 'vue'

import { data as profile } from '../../../data/profile.data'
import { useI18n } from '../../i18n'
import { href, isExternal } from '../../support/paths'

const { m } = useI18n()

const links = computed(() => profile.links)
</script>

<template>
  <section v-if="links.length" class="card">
    <p class="card__title">{{ m.links }}</p>
    <div class="widget__body">
      <ul>
        <li v-for="link in links" :key="link.url">
          <a
            :href="href(link.url)"
            :target="isExternal(link.url) ? '_blank' : undefined"
            :rel="isExternal(link.url) ? 'noopener noreferrer' : undefined"
          >
            {{ link.label }}
          </a>
        </li>
      </ul>
    </div>
  </section>
</template>
