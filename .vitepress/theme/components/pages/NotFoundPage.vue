<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../i18n'
import { href, withLocale } from '../../support/paths'
import AppIcon from '../common/AppIcon.vue'

/**
 * 404 页面。
 *
 * VitePress 会在构建期生成 `404.html`，并把 `page.isNotFound` 置为 true；
 * 由 `Layout.vue` 负责分流到这里（页头页脚已由外壳提供）。
 */

const { m, locale } = useI18n()

/**
 * 「回到首页」指向**当前语言的首页**，不能指向站点根 `/`。
 *
 * `/` 是 `public/index.html` 那份静态跳转页，不在 VitePress 路由表里；
 * 而 404 页本身就处在客户端路由中，跳到 `/` 只会再渲染一次 404，形成死循环。
 */
const homeLink = computed(() => href(withLocale('/', locale.value)))
</script>

<template>
  <div class="container">
    <div class="notfound">
      <p class="notfound__code">404</p>
      <p class="notfound__text">{{ m.notFoundText }}</p>
      <a class="btn btn--accent" :href="homeLink">
        <AppIcon name="arrow-left" />
        {{ m.backHome }}
      </a>
    </div>
  </div>
</template>
