<script setup lang="ts">
import { computed, ref } from 'vue'

import { SITE } from '../../../data/site'
import { useI18n } from '../../i18n'
import { href, withLocale } from '../../support/paths'
import AppIcon from '../common/AppIcon.vue'
import MobileNav from '../mobile/MobileNav.vue'
import LocaleSwitch from './LocaleSwitch.vue'
import SiteNav from './SiteNav.vue'
import ThemeToggle from './ThemeToggle.vue'

/**
 * 页头。
 *
 * **两套结构，不是一套结构两套样式**：
 * - 宽屏：品牌 + 横向导航 + 工具按钮，一行排开；
 * - 窄屏：品牌 + 汉堡按钮，导航整体收进抽屉（`MobileNav`）。
 *
 * 之前是同一套 DOM 靠 `flex-wrap` 挤成两行，实测页头从 65px 涨到 150px，
 * 既吃掉首屏，又把 `--header-height` 这个布局契约顶破
 * （阅读进度条被盖住、锚点跳转被页头遮挡 70px）。
 * 拆成两套之后，两种宽度下的页头高度都是**稳定的一行**。
 *
 * 品牌链接指向**当前语言的首页**（`/zh-cn/`、`/en/`），不是站点根 `/`：
 * 根路径只是 `public/index.html` 那份静态跳转页，不在 VitePress 路由表里，
 * 客户端路由拦截站内 `<a>` 时会查不到页面而渲染成 404。
 */

const { locale, m } = useI18n()

/** 品牌名；想加 logo 就在 `media/` 放图并在这里引入。 */
const brand = computed(() => SITE.name)

const homeLink = computed(() => href(withLocale('/', locale.value)))

/** 移动端抽屉开关。 */
const menuOpen = ref(false)
</script>

<template>
  <header class="site-header">
    <div class="container site-header__inner">
      <!-- 宽屏结构 -->
      <div class="site-header__desktop">
        <a class="site-brand" :href="homeLink">
          <span class="site-brand__text">{{ brand }}</span>
        </a>

        <div class="site-header__right">
          <SiteNav />

          <div class="site-tools">
            <ThemeToggle />
            <LocaleSwitch />
          </div>
        </div>
      </div>

      <!-- 窄屏结构 -->
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
    </div>

    <MobileNav v-model:open="menuOpen" />
  </header>
</template>
