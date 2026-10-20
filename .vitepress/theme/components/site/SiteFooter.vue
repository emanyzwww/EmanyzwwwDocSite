<script setup lang="ts">
import { withBase } from 'vitepress'
import { computed } from 'vue'

import { SITE } from '../../../data/site'
import { useI18n } from '../../i18n'
import { feedPath, href, isExternal } from '../../support/paths'

/**
 * 页脚。
 *
 * 内容来自 `data/site.ts` 的 `footer` 字段：
 * - `copyright` 留空时自动生成 `© 起始年–今年 站点名`（起始年等于今年时只显示一年）；
 * - `links` 为外部链接时自动加 `target="_blank" rel="noopener noreferrer"`；
 * - 末尾固定附加当前语言的 RSS 入口。
 */

const { locale } = useI18n()

const year = new Date().getFullYear()

const copyright = computed(() => {
  if (SITE.footer.copyright) return SITE.footer.copyright
  const range = SITE.since && SITE.since < year ? `${SITE.since}–${year}` : String(year)
  return `© ${range} ${SITE.name}`
})

/** RSS 地址：跟随当前语言。 */
const feedUrl = computed(() => withBase(feedPath(locale.value)))
</script>

<template>
  <footer class="site-footer">
    <div class="container site-footer__inner">
      <p class="site-footer__copyright">{{ copyright }}</p>

      <ul class="site-footer__links">
        <li v-for="link in SITE.footer.links" :key="link.url">
          <a
            :href="href(link.url)"
            :target="isExternal(link.url) ? '_blank' : undefined"
            :rel="isExternal(link.url) ? 'noopener noreferrer' : undefined">
            {{ link.name }}
          </a>
        </li>
        <li>
          <a :href="feedUrl">RSS</a>
        </li>
      </ul>
    </div>
  </footer>
</template>
