<script setup lang="ts">
import { ref } from 'vue'

import { useI18n } from '../../i18n'
import ScrollBar from '../common/ScrollBar.vue'
import MobileDock from '../mobile/MobileDock.vue'
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
 * 4. 移动端悬浮胶囊与全站搜索面板 —— 两者都是「跨页面」能力，
 *    挂在壳上比每个页面各挂一份更省事，也保证任意页面都能唤起。
 *
 * 搜索状态由这里统一持有：桌面入口在 `SiteHeader`，移动入口在
 * `MobileDock`，两边都通过事件把开关请求发上来 —— 面板只有一份，
 * 不会出现「桌面开的和手机开的不是同一个实例」。
 *
 * 自绘滚动条（`ScrollBar`）也挂在这里，与页头**平级**。
 * 它不能挂进 `<header>` 内部：页头的 `backdrop-filter` 会为
 * `position: fixed` 后代创建包含块，把滚动条关进页头的层叠上下文，
 * 那样它的 `z-index` 就只跟页头子元素比，压不住正文了
 * （详见该组件与 base.css 的说明）。
 *
 * 注意：**没有**视口补偿的 JS。
 * 浏览器工具栏收放时胶囊的跟随，交给 `MobileDock` 外层那个
 * `height: 100dvh` 的容器（CSS 由合成器驱动，不需要 JS 逐帧写变量）。
 */

const { m } = useI18n()

const searchOpen = ref(false)
</script>

<template>
  <div class="page-shell">
    <a class="skip-link" href="#main">{{ m.skipToContent }}</a>

    <SiteHeader @search="searchOpen = true" />

    <ScrollBar />

    <!-- tabindex="-1"：让 skip-link 跳过来后焦点真正落在主内容上（Safari 需要） -->
    <main id="main" class="page-shell__main" tabindex="-1">
      <slot />
    </main>

    <SiteFooter />

    <MobileDock @search="searchOpen = true" />

    <SearchPanel v-model:open="searchOpen" />
  </div>
</template>
