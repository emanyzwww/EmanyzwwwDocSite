<script setup lang="ts">
import { useRoute } from 'vitepress'
import { computed, ref, watch } from 'vue'

import { SITE } from '../../../data/site'
import { useI18n } from '../../i18n'
import { href, withLocale } from '../../support/paths'
import AppIcon from '../common/AppIcon.vue'
import MobileNav from './MobileNav.vue'

/**
 * PE（移动端）外壳的页头内容 + 导航抽屉。
 *
 * 窄屏只保留「品牌 + 汉堡」一行，导航整体收进右侧抽屉（`MobileNav`）。
 * 宽屏结构在 `desktop/DesktopHeader.vue`，两者由 `site/SiteHeader.vue` 同时渲染、
 * 由 CSS 媒体查询决定显示哪一份。
 *
 * 抽屉状态归这里持有：它是移动端独有交互，没有理由让内核外壳或 PC 外壳知道。
 */

const { locale, m } = useI18n()
const route = useRoute()

/**
 * 品牌链接指向**当前语言的首页**（`/zh-cn/`、`/en/`），不是站点根 `/`：
 * 根路径只是 `public/index.html` 那份静态跳转页，不在 VitePress 路由表里，
 * 客户端路由拦截站内 `<a>` 时会查不到页面而渲染成 404。
 */
const brand = computed(() => SITE.name)
const homeLink = computed(() => href(withLocale('/', locale.value)))

/** 抽屉开关。 */
const menuOpen = ref(false)

/** 路由切换后关掉抽屉，避免跳转后留下一个盖住新页面的浮层。 */
watch(
  () => route.path,
  () => {
    menuOpen.value = false
  },
)
</script>

<template>
  <div class="site-header__mobile">
    <a class="site-brand" :href="homeLink">
      <span class="site-brand__text">{{ brand }}</span>
    </a>

    <button
      class="m-burger"
      type="button"
      :aria-label="m.openMenu"
      :aria-expanded="menuOpen ? 'true' : 'false'"
      aria-haspopup="dialog"
      @click="menuOpen = true">
      <AppIcon name="menu" />
    </button>
  </div>

  <MobileNav v-model:open="menuOpen" />
</template>
