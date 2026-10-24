<script setup lang="ts">
import { useRoute } from 'vitepress'
import { computed, ref, watch } from 'vue'

import { SITE } from '../../../data/site'
import { useCurrentPost } from '../../composables/useCurrentPost'
import { useDockState } from '../../composables/useDockState'
import { useI18n } from '../../i18n'
import { href, withLocale } from '../../support/paths'
import AppIcon from '../common/AppIcon.vue'
import ProgressBar from '../common/ProgressBar.vue'
import MobileNav from '../mobile/MobileNav.vue'
import LocaleSwitch from './LocaleSwitch.vue'
import SiteNav from './SiteNav.vue'
import ThemeToggle from './ThemeToggle.vue'

/**
 * 页头。
 *
 * **两套结构，不是一套结构两套样式**：
 * - 宽屏：品牌 + 横向导航 + 搜索入口 + 工具按钮，一行排开；
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
 *
 * ---------- 三点移动端改动 ----------
 *
 * 1. **进度条搬进来了**。它现在是页头内部的绝对定位元素，贴在页头下边框上。
 *    好处：页头隐藏时它自动跟随、天然压在所有浮层之下、不需要再用
 *    `top: var(--header-height)` 去猜页头真实高度（此前差 1px，看起来「没贴住」）。
 *
 * 2. **阅读态自动隐藏**。手机上垂直空间是唯一稀缺资源，向下读长文时
 *    页头只是装饰。`useDockState` 判定进入 `reading` 后这里整块上移出屏，
 *    往回滚一点立刻回来。
 *
 * 3. **桌面补了搜索入口**。此前搜索只有 `Ctrl/⌘+K`，不知道快捷键的用户
 *    等于没有这个功能。现在是一颗带快捷键提示 chip 的按钮。
 */

const { locale, m } = useI18n()
const route = useRoute()
const { current } = useCurrentPost()
const { mode } = useDockState()

/** 品牌名；想加 logo 就在 `media/` 放图并在这里引入。 */
const brand = computed(() => SITE.name)

const homeLink = computed(() => href(withLocale('/', locale.value)))

/** 移动端抽屉开关。 */
const menuOpen = ref(false)

/**
 * 搜索面板当前是否打开。
 *
 * 由 `PageShell` 通过 prop 传下来：面板是**唯一一份**（挂在壳上），
 * 而触发按钮在这里 —— 按钮要把 `aria-expanded` 同步成面板的真实状态。
 *
 * 改造前按钮没有任何展开状态标记，读屏用户点完搜索框后
 * 得不到"面板已打开"的反馈（焦点虽然被移进面板，但控件本身没说发生了什么）。
 */
defineProps<{
  searchOpen?: boolean
}>()

/** 搜索面板开关。面板本身由 `PageShell` 渲染，这里只负责发信号。 */
const emit = defineEmits<{
  (e: 'search'): void
}>()

/** 本页是否有文章正文（决定是否渲染进度条）。判定口径与 `DocPage` 一致。 */
const isPost = computed(() => current.value !== undefined)

/** 阅读态：页头整体上移出屏。 */
const hidden = computed(() => mode.value === 'reading')

/**
 * 快捷键提示文案。
 *
 * 按平台显示 `⌘K` 或 `Ctrl K`：统一显示 Ctrl 会让 Mac 用户去按一个
 * 不存在的键。判定只在客户端做，SSR 期间用中性写法避免水合不一致。
 */
const shortcut = ref('Ctrl K')

if (typeof navigator !== 'undefined') {
  const platform = navigator.userAgent
  if (/Mac|iPhone|iPad|iPod/.test(platform)) shortcut.value = '⌘K'
}

/** 打开搜索（同时把 chrome 恢复可见，因为用户正在找东西）。 */
function openSearch(): void {
  emit('search')
}

/** 路由切换后关掉抽屉，避免跳转后留下一个盖住的浮层。 */
watch(
  () => route.path,
  () => {
    menuOpen.value = false
  },
)
</script>

<template>
  <header class="site-header" :class="{ 'is-hidden': hidden }" :data-mode="mode">
    <div class="container site-header__inner">
      <!-- 宽屏结构 -->
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
            @click="openSearch">
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

    <!--
      进度条**在页头内部**，属于页头的一部分。

      它在视觉与语义上都是「页头的边界装饰」——贴在页头下沿、指示本页
      读到哪里，跟着页头一起出现。分开放（旧写法）导致了一个真实 bug：
      `is-hidden` 类在桌面端也会被加上，而让它位移的 CSS 只在移动端媒体查询里，
      于是桌面端页头纹丝不动、进度条却被相邻选择器顶到了屏幕顶端，
      两者彻底分离（实测 gap = -65px，进度条穿进页头里）。

      注意这里用 `position: fixed`（见 posts.css 的说明）：
      固定定位会脱离页头的 `transform` 影响，因此移动端页头整体上移出屏时，
      进度条仍然留在屏幕顶端继续显示 —— 这既是用户明确要求的行为
      （「我被滑走的是 header，但我仍然希望进度条存在」），
      也保证了桌面端与移动端逻辑一致：进度条永远贴在「页头所在的位置」。

      `v-if` 判断是不是文章页，由 `useCurrentPost` 提供，与 DocPage 同源。
    -->
    <ProgressBar v-if="isPost" selector="[data-article-body]" />

    <MobileNav v-model:open="menuOpen" />
  </header>
</template>
