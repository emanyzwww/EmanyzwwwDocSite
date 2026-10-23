<script setup lang="ts">
import { useData } from 'vitepress'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { SITE } from '../../../data/site'
import { useI18n } from '../../i18n'
import { href, withLocale } from '../../support/paths'
import AppIcon from '../common/AppIcon.vue'

/**
 * 移动端底部操作栏。
 *
 * 桌面把「目录」放在右栏常驻、把「回到顶部」交给浏览器/滚轮，
 * 因为鼠标用户能同时看到正文与侧栏。手机上这两者都不成立：
 * 右栏被折到正文下方（要滚到底才看得见），而长文里滚回顶部要点很多次。
 *
 * 所以移动端改成**拇指可达的底部固定栏**：
 * - 目录：就地弹出，不用滚到页面底部；
 * - 回到顶部：滚过一屏后出现；
 * - 搜索：随时可唤起。
 *
 * 只在 `pointer: coarse`（触屏）或窄屏时渲染，桌面完全不出现。
 */

const { m, locale } = useI18n()
const { page, frontmatter } = useData()

const emit = defineEmits<{
  /** 请求打开搜索面板（由 `SiteHeader` 统一管理搜索状态）。 */
  (e: 'search'): void
}>()

const emitSearch = (): void => emit('search')

/** 是否有可展示的目录。与 `DocPage` 的 `hasOutline` 同一判断口径。 */
const hasOutline = computed(() => {
  if (frontmatter.value.outline === false || SITE.outline === false) return false
  return page.value.headers.some((header) => header.level === 2 || header.level === 3)
})

const homeHref = computed(() => href(withLocale('/', locale.value)))
const postsHref = computed(() => href(withLocale('/posts/', locale.value)))

/** 滚动超过一屏才显示「回到顶部」，避免刚进页面就多一个按钮。 */
const showTop = ref(false)

let ticking = false
function onScroll(): void {
  if (ticking) return
  ticking = true
  requestAnimationFrame(() => {
    showTop.value = window.scrollY > window.innerHeight
    ticking = false
  })
}

function backToTop(): void {
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

/** 展开/收起本页目录（目录内容由 VitePress 的 `page.headers` 提供，纯前端）。 */
const tocOpen = ref(false)

function toggleToc(): void {
  tocOpen.value = !tocOpen.value
}

function goTo(anchor: string): void {
  tocOpen.value = false
  // 交给原生锚点跳转：`scroll-padding-top` 会让标题不被页头挡住
  window.location.hash = anchor
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
})

/**
 * 目录项（只取 H2/H3，与主题的 `headers: { level: [2, 3] }` 保持一致）。
 * `page.headers` 是嵌套结构，这里摊平成一级列表——手机屏幕窄，
 * 多级缩进会把文字挤到只剩几个字。
 */
const flatOutline = computed(() => {
  const out: { title: string; slug: string; level: number }[] = []
  const walk = (items: typeof page.value.headers): void => {
    for (const item of items) {
      if (item.level === 2 || item.level === 3) {
        out.push({ title: item.title, slug: item.slug, level: item.level })
      }
      if (item.children?.length) walk(item.children as typeof page.value.headers)
    }
  }
  walk(page.value.headers)
  return out
})
</script>

<template>
  <!--
    目录浮层 Teleport 到 body。
    理由同 `MobileNav`：外壳里的祖先元素带 `backdrop-filter`，
    会为 position: fixed 后代创建包含块，浮层会被裁进页头/底栏的尺寸里。
  -->
  <Teleport to="body">
    <div v-if="tocOpen" class="m-toc" role="dialog" aria-modal="true" :aria-label="m.openToc">
      <button
        class="m-toc__scrim"
        type="button"
        :aria-label="m.closeMenu"
        @click="tocOpen = false" />
      <div class="m-toc__sheet">
        <p class="m-toc__title">
          <AppIcon name="list" />
          {{ m.openToc }}
        </p>
        <ul class="m-toc__list">
          <li v-for="item in flatOutline" :key="item.slug" :data-level="item.level">
            <a :href="`#${item.slug}`" @click.prevent="goTo(item.slug)">{{ item.title }}</a>
          </li>
        </ul>
      </div>
    </div>
  </Teleport>

  <nav class="m-bar" :aria-label="m.menuTitle">
    <a class="m-bar__item" :href="homeHref">
      <AppIcon name="home" />
      <span>{{ m.navHome }}</span>
    </a>

    <a class="m-bar__item" :href="postsHref">
      <AppIcon name="list" />
      <span>{{ m.navPosts }}</span>
    </a>

    <button class="m-bar__item" type="button" @click="emitSearch">
      <AppIcon name="search" />
      <span>{{ m.search }}</span>
    </button>

    <button v-if="hasOutline" class="m-bar__item" type="button" @click="toggleToc">
      <AppIcon name="toc" />
      <span>{{ m.openToc }}</span>
    </button>

    <button
      v-if="showTop"
      class="m-bar__item"
      type="button"
      :aria-label="m.backToTop"
      @click="backToTop">
      <AppIcon name="arrow-up" />
      <span>{{ m.backToTop }}</span>
    </button>
  </nav>
</template>
