<script setup lang="ts">
import { useRoute, useRouter } from 'vitepress'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import { data as searchIndex } from '../../../data/search.data'
import { usePresence } from '../../composables/usePresence'
import { format, useI18n } from '../../i18n'
import {
  acquireScrollLock,
  registerOverlayCloser,
  releaseScrollLock,
  trapFocus,
} from '../../support/overlay'
import { href } from '../../support/paths'
import AppIcon from '../common/AppIcon.vue'

/**
 * 全站搜索面板。
 *
 * 纯前端匹配：构建期已把每页正文压成纯文本（`data/search.data.ts`），
 * 这里只做「小写包含」+ 打分排序，没有运行时请求、没有第三方依赖。
 *
 * 为什么不用 Algolia DocSearch：那会引入第三方请求、外发查询词、
 * 还要把 API key 打进前端 —— 对一个纯静态个人博客是不必要的风险面。
 *
 * 交互约定（与 VitePress 默认行为的差异）：
 * - 桌面：`Ctrl/⌘ + K` 唤起；
 * - 手机：底部操作栏的「搜索」按钮唤起（拇指可达，不必够到页头）；
 * - `↑` `↓` 选择、`Enter` 打开、`Esc` 关闭；
 * - 面板本身就是输入框，打开即聚焦，不多点一次。
 */

const { m, locale } = useI18n()

const open = defineModel<boolean>('open', { default: false })

const route = useRoute()
const router = useRouter()

const query = ref('')
const activeIndex = ref(0)
const inputEl = ref<HTMLInputElement | null>(null)
/** 面板本体（焦点陷阱的边界）。 */
const panelEl = ref<HTMLElement | null>(null)
/** 焦点陷阱的清理函数。 */
let releaseTrap: (() => void) | null = null

/**
 * 进出状态机。
 *
 * `open` 是业务开关（读者视角），`present` / `exiting` 决定 DOM。
 * 关闭时先让退出动画播完再摘掉节点 —— 旧实现是 `v-if`，关闭即消失，
 * 实测 `afterImmediate: false`（同帧就没了，退出动画根本来不及开始）。
 */
const { present, exiting } = usePresence(open)

/** 当前语言的可搜索页面（中英互不干扰）。 */
const candidates = computed(() => searchIndex.docs.filter((doc) => doc.locale === locale.value))

/**
 * 匹配与打分。
 *
 * 打分刻意做得很轻：标题命中权重最高，其次描述，最后正文。
 * 没有引入模糊匹配库 —— 对中文，子串匹配比编辑距离更符合直觉
 * （用户搜「随笔」时不该匹配到「随便」）。
 */
const results = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return []

  const scored: { doc: (typeof candidates.value)[number]; score: number }[] = []

  for (const doc of candidates.value) {
    const title = doc.title.toLowerCase()
    const description = doc.description.toLowerCase()
    const text = doc.text.toLowerCase()
    const tags = doc.tags.toLowerCase()

    let score = 0
    if (title.includes(keyword)) score += 100
    // 标题开头命中比中间命中更相关
    if (title.startsWith(keyword)) score += 50
    if (tags.includes(keyword)) score += 30
    if (description.includes(keyword)) score += 20
    if (text.includes(keyword)) score += 5

    if (score > 0) scored.push({ doc, score })
  }

  return scored
    .toSorted((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((entry) => entry.doc)
})

/** 结果里展示的正文片段：命中位置前后各取一段，方便判断相关性。 */
function snippetOf(text: string): string {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return text.slice(0, 90)

  const index = text.toLowerCase().indexOf(keyword)
  if (index === -1) return text.slice(0, 90)

  const start = Math.max(0, index - 30)
  const end = Math.min(text.length, index + keyword.length + 60)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

/**
 * 面板展开的原点（相对面板自身的百分比），由触发按钮的位置算出。
 *
 * ---------- 为什么需要这个 ----------
 *
 * 改造前桌面端面板固定 `top: 12vh; left: 50%`，而触发按钮在页头右侧。
 * 实测两者错开得很远：
 *
 * ```
 * 触发按钮 (1064, 14) 1024×36
 * 面板     ( 416,108)  608×?     ← 水平差 -440px，垂直差 +94px
 * ```
 *
 * 面板从视口中心凭空出现，读者**看不出它和刚才那个按钮有关系**。
 * 让面板从按钮所在的那一角展开（`transform-origin` + 轻微 scale），
 * 这一层因果关系就被补上了 —— 这是"点击搜索框，弹窗之间毫无动画逻辑"
 * 那条反馈的实质。
 *
 * 只在桌面生效。手机端面板贴顶全宽，原点恒为顶部中央（见 search.css），
 * 那里即使算出来也没有意义（按钮在胶囊里，与面板不在同一平面）。
 */
const origin = ref('50% 0%')

/** 把百分比夹在 [0,100]：原点跑到面板外面会让缩放看起来像"从屏幕外飞入"。 */
function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value))
}

/** 触发按钮：`SiteHeader` 的 `.search-trigger`，或移动胶囊里的搜索项。 */
function computeOrigin(): void {
  if (typeof document === 'undefined') return
  // 移动端贴顶全宽：横向原点固定居中，纵向从顶部展开
  if (window.matchMedia('(max-width: 720px), (pointer: coarse) and (max-height: 500px)').matches) {
    origin.value = '50% 0%'
    return
  }

  const trigger =
    document.querySelector<HTMLElement>('.search-trigger') ??
    document.querySelector<HTMLElement>('.m-dock__item[data-action="search"]')
  const panel = panelEl.value
  if (!trigger || !panel) {
    origin.value = '50% 0%'
    return
  }

  const t = trigger.getBoundingClientRect()
  const p = panel.getBoundingClientRect()
  if (!p.width || !p.height) {
    origin.value = '50% 0%'
    return
  }

  // 用按钮中心作为展开原点
  const x = ((t.x + t.width / 2 - p.x) / p.width) * 100
  const y = ((t.y + t.height / 2 - p.y) / p.height) * 100
  origin.value = `${clampPercent(x).toFixed(1)}% ${clampPercent(y).toFixed(1)}%`
}

function close(): void {
  open.value = false
}

function move(delta: number): void {
  const total = results.value.length
  if (!total) return
  // 循环选择：到底再按 ↓ 回到第一条
  activeIndex.value = (activeIndex.value + delta + total) % total
}

function onInputKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    move(1)
    return
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    move(-1)
    return
  }

  if (event.key === 'Enter') {
    const hit = results.value[activeIndex.value]
    if (!hit) return
    event.preventDefault()
    /*
     * 用 `router.go()`，**不是** `window.location.href`。
     *
     * 旧实现写的是整页跳转，理由写着「搜索结果落点是任意页面，交给浏览器最稳」。
     * 但那造成了一个读者能直接感知的不一致：
     *
     * | 操作              | 导航方式     | 有没有页面过渡 |
     * |-------------------|--------------|----------------|
     * | 鼠标点结果        | 客户端路由   | 有             |
     * | 键盘 Enter        | 整页刷新     | **没有**（白屏）|
     *
     * 同一个搜索结果，换一种输入方式就换一套观感。而且整页导航会丢掉
     * 主题、语言、已加载的搜索索引，退回白屏重来。
     *
     * 站内 URL 一定能被 VitePress 路由解析（索引本来就来自构建期的真实页面），
     * 解析失败时 router 内部有 404 兜底，不存在"整页跳更稳"的问题。
     */
    void router.go(hit.url)
  }
}

// 输入变化时把高亮重置到第一条，否则会停留在一个已不存在的位置
watch(query, () => {
  activeIndex.value = 0
})

watch(open, async (isOpen) => {
  if (typeof document === 'undefined') return

  if (isOpen) {
    query.value = ''
    activeIndex.value = 0
    /*
     * 锁滚动用引用计数：抽屉也持有同一把锁。
     * 旧实现两处各自写 `body.style.overflow`，先开抽屉再开搜索、
     * 然后关搜索，会把抽屉的锁一并清掉（背景突然能滚）；
     * 反序则会锁死（都关了页面却滚不动）。详见 support/overlay.ts。
     */
    acquireScrollLock()
    releaseTrap = trapFocus(() => panelEl.value)
    document.addEventListener('keydown', onGlobalKeydown)
    await nextTick()
    // 必须先渲染再量：`origin` 依赖面板自身的 rect
    computeOrigin()
    inputEl.value?.focus()
  } else {
    // 锁在退出动画期间**继续持有**（见下方 `watch(present)`），避免背景跟着滚
    releaseTrap?.()
    releaseTrap = null
    document.removeEventListener('keydown', onGlobalKeydown)
  }
})

/**
 * 滚动锁跟随 `present` 而不是 `open`。
 *
 * 退出动画 160ms 期间面板还在屏幕上：若在 `open` 变 false 时就解锁，
 * 那 160ms 里背景可以滚动，读者会看到"面板正在淡出、底下的页面却在滑"。
 * 锁的真正释放时机是 DOM 被摘掉。
 */
watch(
  present,
  (isPresent) => {
    if (!isPresent) releaseScrollLock()
  },
  { flush: 'sync' },
)

/*
 * 兜底：路由一变就关掉自己。
 *
 * 主路径是 `support/route-transition.ts` 在导航前调用 `closeAllOverlays()`
 * （读者点搜索结果时的实际路径）。这里再加一道，覆盖"面板开着时用浏览器
 * 前进/后退"——那个路径不走 `onBeforeRouteChange`，登记表不会被调用。
 *
 * 少了这道兜底，读者会在新页面看到一个盖住屏幕、滚不动的搜索面板，
 * 只能靠 Esc 脱身（改造前就是这个症状）。
 */
watch(
  () => route.path,
  () => {
    if (open.value) close()
  },
)

/*
 * 登记到"导航前强制关闭"的名单里。
 *
 * 这里登记的是**把开关置 false**，不是直接销毁 DOM ——
 * 销毁交给 `usePresence`，所以强制关闭时依然有退出动画。
 *
 * 只在客户端登记：SSR 期间 setup 也会跑，但服务端没有"导航前"这件事，
 * 登记进模块级集合只会在长期运行的构建进程里越积越多。
 */
let unregisterCloser: (() => void) | null = null

/** 面板打开时才监听 Esc，避免抢走页面上其它 Esc 行为。 */
function onGlobalKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') close()
}

/** 全局快捷键：桌面用 Ctrl/⌘ + K。 */
function onShortcut(event: KeyboardEvent): void {
  const isK = event.key.toLowerCase() === 'k'
  if (!isK || !(event.metaKey || event.ctrlKey)) return
  event.preventDefault()
  open.value = true
}

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', onShortcut)
  unregisterCloser = registerOverlayCloser(() => {
    if (open.value) close()
  })
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onShortcut)
    document.removeEventListener('keydown', onGlobalKeydown)
    unregisterCloser?.()
    unregisterCloser = null
    // 卸载时必须释放，否则路由跳转销毁面板时锁会残留
    releaseScrollLock()
    releaseTrap?.()
    releaseTrap = null
  })
}
</script>

<template>
  <!-- Teleport 到 body：理由同 MobileNav —— 祖先的 backdrop-filter 会
       为 position: fixed 后代创建包含块，面板会被裁进外壳的尺寸。 -->
  <Teleport to="body">
    <div
      v-if="present"
      class="search"
      :class="{ 'is-exiting': exiting }"
      role="dialog"
      aria-modal="true"
      :aria-label="m.search">
      <button class="search__scrim" type="button" :aria-label="m.closeMenu" @click="close" />

      <div ref="panelEl" class="search__panel" :style="{ transformOrigin: origin }">
        <div class="search__field">
          <AppIcon name="search" />
          <input
            ref="inputEl"
            v-model="query"
            class="search__input"
            type="text"
            role="combobox"
            :aria-label="m.search"
            :placeholder="m.searchPlaceholder"
            aria-autocomplete="list"
            aria-controls="search-results"
            :aria-expanded="results.length > 0 ? 'true' : 'false'"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            @keydown="onInputKeydown" />
          <button class="search__close" type="button" :aria-label="m.closeMenu" @click="close">
            <AppIcon name="close" />
          </button>
        </div>

        <p v-if="query && results.length" class="search__count">
          {{ format(m.searchResults, { count: results.length }) }}
        </p>

        <ul v-if="results.length" id="search-results" class="search__list" role="listbox">
          <li
            v-for="(doc, index) in results"
            :key="doc.url"
            role="option"
            :aria-selected="index === activeIndex ? 'true' : 'false'">
            <a
              class="search__item"
              :class="{ 'is-active': index === activeIndex }"
              :href="href(doc.url)"
              @mouseenter="activeIndex = index">
              <span class="search__item-head">
                <span class="search__item-title">{{ doc.title }}</span>
                <span class="search__item-kind">
                  {{ doc.kind === 'post' ? m.navPosts : m.navHome }}
                </span>
              </span>
              <span class="search__item-text">{{ snippetOf(doc.text || doc.description) }}</span>
            </a>
          </li>
        </ul>

        <p v-else-if="query" class="search__empty">{{ m.searchEmpty }}</p>

        <p v-else class="search__hint">{{ m.searchHint }}</p>

        <p class="search__foot">{{ m.searchNavigate }}</p>
      </div>
    </div>
  </Teleport>
</template>
