<script setup lang="ts">
/**
 * 页头：品牌 + 导航 + 工具（主题 / 语言）。
 *
 * 与旧站的区别：
 * - 品牌名与 logo 直接读 `data/site.ts`，不再有 brandName/brand 的层层回退；
 * - 主题与语言按钮共用 `.icon-button`，几何参数只有一处定义。
 */
import { computed } from 'vue'

import { withBase } from 'vitepress'

import { SITE } from '../../../data/site'
import LocaleSwitch from './LocaleSwitch.vue'
import SiteNav from './SiteNav.vue'
import ThemeToggle from './ThemeToggle.vue'

/** 品牌名；想加 logo 就在 `docs/media/` 放图并在这里引入。 */
const brand = computed(() => SITE.name)
</script>

<template>
  <header class="site-header">
    <div class="container site-header__inner">
      <a class="site-brand" :href="withBase('/')">
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
