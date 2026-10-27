<script setup lang="ts">
import { useData } from 'vitepress'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { SITE } from '../../../data/site'
import { useDockState } from '../../composables/useDockState'
import { usePresence } from '../../composables/usePresence'
import { useI18n } from '../../i18n'
import {
  acquireScrollLock,
  isScrollLocked,
  onScrollLockRelease,
  registerOverlayCloser,
  releaseScrollLock,
  trapFocus,
} from '../../support/overlay'
import { href, postListPath, withLocale } from '../../support/paths'
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
 * | 展开    | 居中横向胶囊（4 个图标+文字） | 顶部 / 上滚 60px / 程序化跳转 |
 * | 收起    | 右下角一个圆（只有目录图标）  | 下滚 60px 进入阅读态     |
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
const postsHref = computed(() => href(postListPath(locale.value)))

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
/** 目录浮层本体（焦点陷阱边界）。 */
const tocSheet = ref<HTMLElement | null>(null)
let releaseTrap: (() => void) | null = null

/** 进出状态机：关闭时先播退出动画再摘 DOM（见 usePresence）。 */
const { present: tocPresent, exiting: tocExiting } = usePresence(tocOpen)

function openToc(): void {
  // 打开目录说明用户要找东西了：先把 chrome 恢复，再开 sheet
  reset()
  tocOpen.value = true
}

function closeToc(): void {
  tocOpen.value = false
}

/*
 * 目录浮层同样是模态：打开期间背景不该能滚。
 *
 * 用户反馈「抽屉和搜索打开后仍能滑动内容」—— 目录浮层有同一个问题。
 * 这里复用同一把引用计数锁（`support/overlay.ts`），
 * 与抽屉、搜索共享计数，不会互相清锁。
 *
 * 释放时机跟着 `tocPresent`（退出动画播完）而不是 `tocOpen`，
 * 理由同搜索面板：否则淡出的 160ms 里背景可以滚，画面会"半透明 + 底下在动"。
 */
watch(tocOpen, (isOpen) => {
  if (typeof document === 'undefined') return

  if (isOpen) {
    acquireScrollLock()
    releaseTrap = trapFocus(() => tocSheet.value)
    // 等渲染完再移焦点
    requestAnimationFrame(() => tocSheet.value?.querySelector('a')?.focus())
  } else {
    releaseTrap?.()
    releaseTrap = null
  }
})

watch(
  tocPresent,
  (isPresent) => {
    if (!isPresent) releaseScrollLock()
  },
  { flush: 'sync' },
)

/**
 * 在滚动锁释放后再执行一次滚动。
 *
 * ---------- 为什么不能直接滚 ----------
 *
 * 浮层关闭时 `tocOpen` 立刻变 false，但 DOM 还要留 160ms 播退出动画
 * （`usePresence`），滚动锁也是在 DOM 真正摘掉时才释放。
 * 那 160ms 里 `html { overflow: hidden }` 仍然生效 —— 而 iOS 上还有
 * 更硬的一层：`body { position: fixed }`。
 *
 * 在这个窗口里调 `window.scrollTo()` 或给 `location.hash` 赋值都是**静默失败**：
 * 不报错、不滚动。这正是「手机上目录跳转经常失效」的原因
 * （PC 端目录在侧栏、不持锁，所以永远正常）。
 *
 * 所以统一走这里：锁着就排队等释放，没锁就直接滚。
 */
function scrollAfterUnlock(run: () => void): void {
  if (!isScrollLocked()) {
    run()
    return
  }
  onScrollLockRelease(() => {
    // 下一帧：那时 body 的 fixed 已还原、布局已重算，量的坐标才对
    requestAnimationFrame(run)
  })
}

/**
 * 点击目录项时**只关浮层**，不做滚动。
 *
 * ---------- 为什么不在这里滚 ----------
 *
 * 滚动由 `support/anchor-scroll.ts` 统一负责：它在 `document` 捕获阶段
 * 接管这次点击，发现滚动锁还没释放（浮层正开着）就把滚动**排队**，
 * 等浮层真正关闭、锁归零后再执行。
 *
 * 第一版这里是 `window.location.hash = slug`，那正是 bug 的来源：
 * 赋值发生在锁定期间 —— iOS 上 `body { position: fixed }` 会把原生滚动
 * 整个吞掉，而且**不报错**。于是"点了没反应"，且 PC 端永远复现不出来
 * （PC 的目录在侧栏、不持锁）。详见 `anchor-scroll.ts` 的 `requestAnchorScroll`。
 *
 * 现在的分工：
 * - 本函数：关浮层 + 抑制阅读态误判；
 * - `anchor-scroll`：算位置、等锁、滚动、更新 hash（用 replaceState）。
 */
function goTo(): void {
  tocOpen.value = false
  /*
   * 跳转后**必须保持展开态**，无论目标在下方还是上方。
   *
   * 根因：`html { scroll-behavior: smooth }` 会让跳转变成一段动画，
   * 期间持续产生 `scroll` 事件。跳到下方章节时那是一长串**向下**滚动 ——
   * 不抑制的话，动画结束后状态机刚好判定为 `reading`，
   * 于是「向上跳 → 展开，向下跳 → 隐藏」，同一个操作两种结果。
   *
   * `reset()` 现在带 holdUntil（默认 700ms），足够盖住平滑滚动动画：
   * 期间强制 rest 且不累计位移，动画结束后状态就稳定在展开。
   *
   * 注：`holdUntil` 的 700ms 是从**现在**算起，而真正的滚动要等锁释放
   * （约 160ms 后）才开始 —— 两者相加仍在 700ms 窗口内，够用。
   */
  reset()
}

function backToTop(): void {
  tocOpen.value = false
  // 同样是程序化滚动：抑制判定，否则平滑上滚会被误判成状态切换
  reset()
  /*
   * 回到顶部没有对应的锚点链接，所以不会经过 `anchor-scroll` 的队列，
   * 必须自己等锁释放 —— 否则浮层还在淡出的 160ms 里这次滚动会被吃掉，
   * 表现为「点了回到顶部没反应」（和标题跳转同一个 bug）。
   */
  scrollAfterUnlock(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  })
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

/* ---------- 恢复展开 ----------
 *
 * 第一版在这里挂了 `touchstart` / `touchmove`，手指一放上去就记起点，
 * 上移 12px 就恢复 —— 结果是「手指刚碰屏幕还没滑，胶囊就弹开了」，
 * 紧接着继续下滚又收回去，来回抽搐。
 *
 * **触摸本身不携带意图，滚动位移才携带。** 所以手势全部删掉，
 * 只保留滚动判定（`useDockState`）。它现在有对称滞回（上滚 60px 才恢复）
 * 和冷却期，不会因为一次手势里的微小抖动来回翻。
 *
 * 只保留一条：滚回顶部时确保展开 —— 这是**位置**约束，与手势无关。
 */

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

/** 登记表注销函数（`onMounted` 里赋值）。 */
let unregisterCloser: (() => void) | null = null

onMounted(() => {
  window.addEventListener('scroll', onScrollGuard, { passive: true })
  document.addEventListener('keydown', onKeydown)
  /*
   * 登记到"导航前强制关闭"的名单（见 support/overlay.ts）。
   *
   * 目录 sheet 里的链接是 `#锚点`，点完不换页面，所以它不需要被导航关掉 ——
   * 但读者可能从 sheet 里点"回到顶部"后再立刻点胶囊去别的页。
   * 统一登记，保证任何一次真实导航前都是干净状态。
   */
  unregisterCloser = registerOverlayCloser(() => {
    if (tocOpen.value) closeToc()
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScrollGuard)
  document.removeEventListener('keydown', onKeydown)
  /*
   * 卸载时必须释放锁：路由切换可能直接销毁组件（`v-if` 跟着页面走），
   * 那时 `watch(tocOpen)` 的 else 分支不一定会跑，锁会永久残留。
   * `releaseScrollLock` 内部有「计数不小于 0」保护，重复调用安全。
   */
  releaseScrollLock()
  releaseTrap?.()
  releaseTrap = null
  unregisterCloser?.()
  unregisterCloser = null
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
    <div
      v-if="tocPresent"
      class="m-toc"
      :class="{ 'is-exiting': tocExiting }"
      role="dialog"
      aria-modal="true"
      :aria-label="m.openToc">
      <button class="m-toc__scrim" type="button" :aria-label="m.closeToc" @click="closeToc" />

      <div ref="tocSheet" class="m-toc__sheet">
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

        <!--
          `vp-raw`：让 VitePress 的点击委托放行，锚点滚动由 anchor-scroll
          独家接管（桌面目录同款，理由见 OutlineCard.vue）。
        -->
        <ul class="m-toc__list vp-raw">
          <li v-for="item in flatOutline" :key="item.slug" :data-level="item.level">
            <a :href="`#${item.slug}`" @click.prevent="goTo()">{{ item.title }}</a>
          </li>
        </ul>
      </div>
    </div>
  </Teleport>

  <!--
    胶囊本体。

    外面这层 `.m-dock-layer` 是**动态视口容器**，不是多余的包装：
    `position: fixed` 的元素贴的是 layout viewport，而移动浏览器地址栏 /
    底部工具栏展开时它比可视区域高。胶囊放进一个 `height: 100dvh` 的固定层后，
    由浏览器在合成阶段按**当前**可视高度求值，工具栏收放时胶囊才能跟手
    （详见 mobile.css 里 `.m-dock-layer` 的注释）。
  -->
  <div class="m-dock-layer">
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
  </div>
</template>
