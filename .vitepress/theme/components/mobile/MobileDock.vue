<script setup lang="ts">
import { useData } from 'vitepress'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { SITE } from '../../../data/site'
import { useDockState } from '../../composables/useDockState'
import { useI18n } from '../../i18n'
import { href, withLocale } from '../../support/paths'
import AppIcon from '../common/AppIcon.vue'

/**
 * 移动端悬浮胶囊导航。
 *
 * ---------- 为什么不再是通栏底栏 ----------
 *
 * 旧实现是一条 `position: fixed; bottom: 0; left: 0; right: 0` 的通栏横条：
 * - 它把屏幕底部**整条切掉**，视觉上像「浏览器自己的工具栏」，
 *   和页面内容抢地盘，也压掉了圆角屏的安全区；
 * - 它和页头一样永远占据 ~52px，读长文时是纯浪费。
 *
 * 现在改成**悬浮胶囊**：不贴边、左右留白、圆角、半透明毛玻璃。
 * 它看起来是「浮在内容之上的一小块」，而不是「页面被截断了一条」。
 *
 * ---------- 两种形态 ----------
 *
 * | 形态    | 样子                       | 触发                     |
 * |---------|----------------------------|--------------------------|
 * | 展开    | 居中横向胶囊（4 个图标+文字） | 顶部 / 向上滚 / 上滑手势 |
 * | 收起    | 右下角一个圆（只有目录图标）  | 向下滚进入阅读态         |
 *
 * 收缩动画的关键：胶囊右边缘**固定不动**，只有宽度在变。
 * 用 `translateX(calc(50vw - 1.25rem - 50%))` 配 `left: 50%`，
 * 由于 transform 的百分比按元素**当前**宽度解析，
 * 右边缘 = 50vw + translateX + w/2 = 100vw - 1.25rem 恒成立 ——
 * 视觉上就是「左边缘一路向右扫过去收成一个圆」，正是想要的效果。
 *
 * 收起后那颗圆默认是**章节导航按钮**，点开目录；往上滑一点即恢复全部菜单。
 *
 * ---------- 为什么不复用一套 DOM ----------
 *
 * 展开态要「图标 + 文字」，收起态只有「一个图标」。两者尺寸差 6 倍，
 * 用同一份 DOM 做缩放会把文字压缩成不可读的细条。这里分成两套，
 * 靠透明度交叉淡入淡出——视觉上比强行变形干净得多。
 */

const { m, locale } = useI18n()
const { page, frontmatter } = useData()
const { mode, reset } = useDockState()

const emit = defineEmits<{
  /** 请求打开搜索面板（由 `PageShell` 统一管理搜索状态）。 */
  (e: 'search'): void
}>()

const homeHref = computed(() => href(withLocale('/', locale.value)))
const postsHref = computed(() => href(withLocale('/posts/', locale.value)))

/** 是否有可展示的目录。与 `DocPage` 的 `hasOutline` 同一判断口径。 */
const hasOutline = computed(() => {
  if (frontmatter.value.outline === false || SITE.outline === false) return false
  return page.value.headers.some((header) => header.level === 2 || header.level === 3)
})

/**
 * 只有「有目录的文章页」才值得收起成圆。
 *
 * 首页、文章列表、标签页通常不长，而且收起后那颗圆唯一功能是开目录——
 * 没有目录时收起来就是个点了没用的按钮。所以这些页面保持展开态。
 */
const canCollapse = computed(() => hasOutline.value)

/** 是否真的处于收起态。 */
const collapsed = computed(() => canCollapse.value && mode.value === 'reading')

/* ---------- 目录 sheet ---------- */

const tocOpen = ref(false)

function openToc(): void {
  // 打开目录说明用户要找东西了：先把 chrome 恢复，再开 sheet
  reset()
  tocOpen.value = true
}

function closeToc(): void {
  tocOpen.value = false
}

function goTo(slug: string): void {
  tocOpen.value = false
  window.location.hash = slug
}

function backToTop(): void {
  tocOpen.value = false
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

/** 目录项：只取 H2/H3，摊平成一级（手机窄，多级缩进会把文字挤没）。 */
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

/* ---------- 手势：从圆心恢复全部菜单 ---------- */

/*
 * 用户的原话是「想回去的话就往上滑一点」。滚动本身也能恢复
 * （`useDockState` 对向上滚动很敏感），但快速滑动时滚动事件会被合并，
 * 手势能更跟手。这里只**读**手势、不 `preventDefault`，页面照常滚动。
 */
let touchStartY = 0

function onTouchStart(event: TouchEvent): void {
  touchStartY = event.touches[0]?.clientY ?? 0
}

function onTouchMove(event: TouchEvent): void {
  if (!collapsed.value) return
  const y = event.touches[0]?.clientY ?? 0
  // 手指上移 12px 就恢复：足够宽松，不会和点击冲突
  if (touchStartY - y >= 12) reset()
}

/** 滚回顶部时确保胶囊展开，否则停在圆形态会让人找不到菜单。 */
function onScrollGuard(): void {
  if (window.scrollY <= 8 && collapsed.value) reset()
}

/** Esc 关闭目录。只在打开时生效，避免抢走页面其它 Esc 行为。 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !tocOpen.value) return
  event.preventDefault()
  closeToc()
}

onMounted(() => {
  /*
   * 手势监听挂在 window 上（不是胶囊上）：收起后胶囊只有 52px，
   * 手指大概率落在胶囊外面，挂在胶囊上会收不到手势。
   */
  window.addEventListener('touchstart', onTouchStart, { passive: true })
  window.addEventListener('touchmove', onTouchMove, { passive: true })
  window.addEventListener('scroll', onScrollGuard, { passive: true })
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('touchstart', onTouchStart)
  window.removeEventListener('touchmove', onTouchMove)
  window.removeEventListener('scroll', onScrollGuard)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <!--
      目录浮层：贴底 sheet。
      头部固定一条「回到顶部」，中部是可滚动的章节列表。
      Teleport 的理由同抽屉：祖先的 backdrop-filter 会为 position: fixed
      后代创建包含块，浮层会被裁进胶囊的尺寸里。
    -->
    <div v-if="tocOpen" class="m-toc" role="dialog" aria-modal="true" :aria-label="m.openToc">
      <button class="m-toc__scrim" type="button" :aria-label="m.closeMenu" @click="closeToc" />

      <div class="m-toc__sheet">
        <div class="m-toc__head">
          <p class="m-toc__title">
            <AppIcon name="toc" />
            {{ m.openToc }}
          </p>
          <button class="m-toc__top" type="button" @click="backToTop">
            <AppIcon name="arrow-up" />
            {{ m.backToTop }}
          </button>
        </div>

        <ul class="m-toc__list">
          <li v-for="item in flatOutline" :key="item.slug" :data-level="item.level">
            <a :href="`#${item.slug}`" @click.prevent="goTo(item.slug)">{{ item.title }}</a>
          </li>
        </ul>
      </div>
    </div>
  </Teleport>

  <!-- 胶囊本体 -->
  <nav
    class="m-dock"
    :class="{ 'is-collapsed': collapsed }"
    :data-mode="mode"
    :aria-label="m.menuTitle">
    <!-- 展开态：横向胶囊 -->
    <div class="m-dock__items" :aria-hidden="collapsed ? 'true' : undefined">
      <a class="m-dock__item" :href="homeHref" :tabindex="collapsed ? -1 : 0">
        <AppIcon name="home" />
        <span>{{ m.navHome }}</span>
      </a>

      <a class="m-dock__item" :href="postsHref" :tabindex="collapsed ? -1 : 0">
        <AppIcon name="list" />
        <span>{{ m.navPosts }}</span>
      </a>

      <button
        class="m-dock__item"
        type="button"
        :tabindex="collapsed ? -1 : 0"
        @click="emit('search')">
        <AppIcon name="search" />
        <span>{{ m.search }}</span>
      </button>

      <button
        v-if="hasOutline"
        class="m-dock__item"
        type="button"
        :tabindex="collapsed ? -1 : 0"
        :aria-expanded="tocOpen ? 'true' : 'false'"
        @click="openToc">
        <AppIcon name="toc" />
        <span>{{ m.openToc }}</span>
      </button>
    </div>

    <!-- 收起态：一个圆，即章节导航按钮 -->
    <button
      v-if="hasOutline"
      class="m-dock__mini"
      type="button"
      :tabindex="collapsed ? 0 : -1"
      :aria-hidden="collapsed ? undefined : 'true'"
      :aria-expanded="tocOpen ? 'true' : 'false'"
      :aria-label="m.openToc"
      @click="openToc">
      <AppIcon name="toc" />
    </button>
  </nav>
</template>
