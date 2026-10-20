<script setup lang="ts">
/**
 * 页面外壳。
 *
 * 承担三件事：
 * 1. 无障碍跳转链接（对应旧站 baseof.html 的 skip-link）；
 * 2. 页头 / 页脚 / 主内容三段的 flex 骨架，让页脚始终贴底；
 * 3. 把 `#main` 交给具体布局填充。
 *
 * 内容区宽度由各布局自己决定（两栏 / 三栏），外壳只管纵向结构。
 */
import { useI18n } from '../../i18n'
import SiteFooter from '../site/SiteFooter.vue'
import SiteHeader from '../site/SiteHeader.vue'

const { m } = useI18n()
</script>

<template>
  <div class="page-shell">
    <a class="skip-link" href="#main">{{ m.skipToContent }}</a>

    <SiteHeader />

    <main id="main" class="page-shell__main">
      <slot />
    </main>

    <SiteFooter />
  </div>
</template>
