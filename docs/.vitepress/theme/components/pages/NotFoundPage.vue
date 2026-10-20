<script setup lang="ts">
/**
 * 404 页面。
 *
 * VitePress 会在构建期生成 `404.html`，并把 `page.isNotFound` 置为 true；
 * 由 `Layout.vue` 负责分流到这里（页头页脚已由外壳提供）。
 */
import { withBase } from 'vitepress'

import { useI18n } from '../../i18n'
import AppIcon from '../common/AppIcon.vue'

const { m } = useI18n()
</script>

<template>
  <div class="container">
    <div class="notfound">
      <p class="notfound__code">404</p>
      <p class="notfound__text">{{ m.notFoundText }}</p>
      <a class="btn btn--accent" :href="withBase('/')">
        <AppIcon name="arrow-left" />
        {{ m.backHome }}
      </a>
    </div>
  </div>
</template>
