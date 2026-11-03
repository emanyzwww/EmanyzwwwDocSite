<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { SITE } from '../../../data/site'
import { useI18n } from '../../i18n'
import { href, withLocale } from '../../support/paths'
import AppIcon from '../common/AppIcon.vue'
import LocaleSwitch from '../site/LocaleSwitch.vue'
import SiteNav from '../site/SiteNav.vue'
import ThemeToggle from '../site/ThemeToggle.vue'

/**
 * PC 外壳的页头内容。
 *
 * 只负责宽屏那一行：品牌 + 横向导航 + 搜索入口 + 工具按钮。
 * 窄屏结构在 `mobile/MobileHeader.vue`，两者由 `site/SiteHeader.vue` 同时渲染、
 * 由 CSS 媒体查询决定显示哪一份（静态站是 SSR + 水合，不能按设备条件渲染）。
 *
 * 搜索面板本身由 `AppShell` 持有（全站唯一一份），这里只把「打开」的信号抛上去，
 * 并把面板的真实开关状态镜像到 `aria-expanded`。
 */

const { locale, m } = useI18n()

defineProps<{ searchOpen?: boolean }>()
const emit = defineEmits<{ (e: 'search'): void }>()

/** 品牌名；想加 logo 就在 `media/` 放图并在这里引入。 */
const brand = computed(() => SITE.name)

/**
 * 品牌链接指向**当前语言的首页**（`/zh-cn/`、`/en/`），不是站点根 `/`：
 * 根路径只是 `public/index.html` 那份静态跳转页，不在 VitePress 路由表里，
 * 客户端路由拦截站内 `<a>` 时会查不到页面而渲染成 404。
 */
const homeLink = computed(() => href(withLocale('/', locale.value)))

/**
 * 快捷键提示文案：按平台显示 `⌘K` 或 `Ctrl K`。
 * 统一显示 Ctrl 会让 Mac 用户去按一个不存在的键。
 *
 * 平台判定放在 `onMounted`，不能在 setup 里做：构建期 SSR 跑在 Node 上，
 * Node ≥ 21 也有全局 `navigator`（userAgent 是 `Node.js/...`），
 * 在 setup 里判定会让服务端输出与 Mac 客户端首帧不一致（水合告警 + 闪变）。
 * 等挂载后再改，代价只是首帧一瞬间的中性文案。
 */
const shortcut = ref('Ctrl K')

onMounted(() => {
  if (/Mac|iPhone|iPad|iPod/.test(navigator.userAgent)) shortcut.value = '⌘K'
})
</script>

<template>
  <div class="site-header__desktop">
    <a class="site-brand" :href="homeLink">
      <span class="site-brand__text">{{ brand }}</span>
    </a>

    <div class="site-header__right">
      <SiteNav />

      <!--
        搜索入口。做成「输入框形状的按钮」：一眼能看出这里能搜，
        同时右侧的快捷键 chip 告诉键盘用户可以去按什么。
      -->
      <button
        class="search-trigger"
        type="button"
        :aria-label="m.search"
        aria-haspopup="dialog"
        :aria-expanded="searchOpen ? 'true' : 'false'"
        @click="emit('search')">
        <AppIcon name="search" />
        <span class="search-trigger__text">{{ m.search }}</span>
        <kbd class="search-trigger__kbd">{{ shortcut }}</kbd>
      </button>

      <div class="site-tools">
        <ThemeToggle />
        <LocaleSwitch />
      </div>
    </div>
  </div>
</template>
