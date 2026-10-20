<script setup lang="ts">
import { computed } from 'vue'

import { SITE } from '../../../data/site'
import { useI18n } from '../../i18n'
import { href, withLocale } from '../../support/paths'
import LocaleSwitch from './LocaleSwitch.vue'
import SiteNav from './SiteNav.vue'
import ThemeToggle from './ThemeToggle.vue'

/**
 * 页头：品牌 + 导航 + 工具（主题 / 语言）。
 *
 * 与旧站的区别：
 * - 品牌名与 logo 直接读 `data/site.ts`，不再有 brandName/brand 的层层回退；
 * - 主题与语言按钮共用 `.icon-button`，几何参数只有一处定义。
 */

const { locale } = useI18n()

/** 品牌名；想加 logo 就在 `media/` 放图并在这里引入。 */
const brand = computed(() => SITE.name)

/**
 * 品牌链接指向**当前语言的首页**（`/zh-cn/`、`/en/`），不是站点根 `/`。
 *
 * 根路径 `/` 只是 `public/index.html` 这份静态跳转页，它**不在 VitePress
 * 的路由表里**（`docs/` 下没有 `index.md`）。而 VitePress 的客户端路由会拦截站内
 * `<a>` 点击、按路由表解析目标：指向 `/` 时查不到页面，会直接渲染成 404。
 * 所以任何站内链接都不能写 `/`，一律用 `withLocale` 带上语言前缀。
 */
const homeLink = computed(() => href(withLocale('/', locale.value)))
</script>

<template>
  <header class="site-header">
    <div class="container site-header__inner">
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
  </header>
</template>
