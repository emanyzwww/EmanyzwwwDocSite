<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import { data as searchIndex } from '../../../data/search.data'
import { format, useI18n } from '../../i18n'
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

const query = ref('')
const activeIndex = ref(0)
const inputEl = ref<HTMLInputElement | null>(null)

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
    // 用整页跳转：搜索结果的落点是任意页面，交给浏览器导航最稳
    window.location.href = href(hit.url)
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
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onGlobalKeydown)
    await nextTick()
    inputEl.value?.focus()
  } else {
    document.body.style.overflow = ''
    document.removeEventListener('keydown', onGlobalKeydown)
  }
})

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
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onShortcut)
    document.removeEventListener('keydown', onGlobalKeydown)
    document.body.style.overflow = ''
  })
}
</script>

<template>
  <!-- Teleport 到 body：理由同 MobileNav —— 祖先的 backdrop-filter 会
       为 position: fixed 后代创建包含块，面板会被裁进外壳的尺寸。 -->
  <Teleport to="body">
    <div v-if="open" class="search" role="dialog" aria-modal="true" :aria-label="m.search">
      <button class="search__scrim" type="button" :aria-label="m.closeMenu" @click="close" />

      <div class="search__panel">
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
