<script setup lang="ts">
import { ref } from 'vue'

import { useI18n } from '../../i18n'
import MobileBar from '../mobile/MobileBar.vue'
import SearchPanel from '../site/SearchPanel.vue'
import SiteFooter from '../site/SiteFooter.vue'
import SiteHeader from '../site/SiteHeader.vue'

/**
 * 页面外壳。
 *
 * 承担四件事：
 * 1. 无障碍跳转链接（对应旧站 baseof.html 的 skip-link）；
 * 2. 页头 / 页脚 / 主内容三段的 flex 骨架，让页脚始终贴底；
 * 3. 把 `#main` 交给具体布局填充；
 * 4. 移动端底部操作栏与全站搜索面板 —— 两者都是「跨页面」能力，
 *    挂在壳上比每个页面各挂一份更省事，也保证任意页面都能唤起。
 *
 * 内容区宽度由各布局自己决定（两栏 / 三栏），外壳只管纵向结构。
 */

const { m } = useI18n()

/** 搜索面板开关，由底栏的「搜索」按钮唤起。 */
const searchOpen = ref(false)
</script>

<template>
  <div class="page-shell">
    <a class="skip-link" href="#main">{{ m.skipToContent }}</a>

    <SiteHeader />

    <!-- tabindex="-1"：让 skip-link 跳过来后焦点真正落在主内容上（Safari 需要） -->
    <main id="main" class="page-shell__main" tabindex="-1">
      <slot />
    </main>

    <SiteFooter />

    <MobileBar @search="searchOpen = true" />

    <SearchPanel v-model:open="searchOpen" />
  </div>
</template>
