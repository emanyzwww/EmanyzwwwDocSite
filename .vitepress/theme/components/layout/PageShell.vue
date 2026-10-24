<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

import { useImageViewer } from '../../composables/useImageViewer'
import { useI18n } from '../../i18n'
import ImageViewer from '../common/ImageViewer.vue'
import ScrollBar from '../common/ScrollBar.vue'
import MobileDock from '../mobile/MobileDock.vue'
import SearchPanel from '../site/SearchPanel.vue'
import SiteFooter from '../site/SiteFooter.vue'
import SiteHeader from '../site/SiteHeader.vue'

/**
 * 页面外壳。
 *
 * 承担五件事：
 * 1. 无障碍跳转链接（对应旧站 baseof.html 的 skip-link）；
 * 2. 页头 / 页脚 / 主内容三段的 flex 骨架，让页脚始终贴底；
 * 3. 把 `#main` 交给具体布局填充；
 * 4. 移动端悬浮胶囊与全站搜索面板 —— 两者都是「跨页面」能力，
 *    挂在壳上比每个页面各挂一份更省事，也保证任意页面都能唤起。
 * 5. 图片查看器 —— 同理，而且它的入口（正文里的 `<a data-lightbox>`）
 *    是**构建期生成的 HTML**，不是 Vue 组件，只能用事件委托接。
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
const { open: openLightbox } = useImageViewer()

const searchOpen = ref(false)

/**
 * 点击委托：正文图片 → 打开查看器。
 *
 * **为什么用委托而不是给每张图绑监听**：
 * 正文是构建期渲染好的静态 HTML（`<Content />` 只是把 vnode 插进来），
 * 没有可挂 `@click` 的 Vue 组件。给每个 `<a data-lightbox>` 手动
 * `addEventListener` 又要在路由切换后重新遍历 —— 委托一次就够，且天然覆盖
 * 客户端路由换页后的新 DOM。
 *
 * 三条必须放行的点击：
 * - `Ctrl/⌘/Shift/Alt + 点击`：读者想在新标签页打开原图，尊重浏览器行为；
 * - 中键 / 右键：同上（只处理 `button === 0`）；
 * - 已经 `preventDefault` 过的（例如未来的其它插件）。
 */
function onDocumentClick(event: MouseEvent): void {
  if (event.defaultPrevented) return
  if (event.button !== 0) return
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

  const target = event.target as Element | null
  const anchor = target?.closest?.('a[data-lightbox]')
  if (!(anchor instanceof HTMLAnchorElement)) return
  // 锚点不在主内容里（比如侧栏恰好也有 data-lightbox）就不接管
  if (!anchor.closest('.prose')) return

  event.preventDefault()
  openLightbox(anchor)
}

/** 键盘：在图片链接上按 Enter 时同样打开（`<a href>` 会被浏览器"导航"到原图）。 */
function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter') return

  const active = document.activeElement
  if (!(active instanceof HTMLAnchorElement) || !active.matches('a[data-lightbox]')) return
  if (!active.closest('.prose')) return

  event.preventDefault()
  openLightbox(active)
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onDocumentKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onDocumentKeydown)
})
</script>

<template>
  <div class="page-shell">
    <a class="skip-link" href="#main">{{ m.skipToContent }}</a>

    <SiteHeader :search-open="searchOpen" @search="searchOpen = true" />

    <ScrollBar />

    <!-- tabindex="-1"：让 skip-link 跳过来后焦点真正落在主内容上（Safari 需要） -->
    <main id="main" class="page-shell__main" tabindex="-1">
      <slot />
    </main>

    <SiteFooter />

    <MobileDock @search="searchOpen = true" />

    <SearchPanel v-model:open="searchOpen" />

    <ImageViewer />
  </div>
</template>
