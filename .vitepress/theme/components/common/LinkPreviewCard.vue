<script setup lang="ts">
import { computed, watch } from 'vue'

import type { IconName } from '../../../types'
import { useLinkPreview } from '../../composables/useLinkPreview'
import { usePresence } from '../../composables/usePresence'
import AppIcon from '../common/AppIcon.vue'

/**
 * 链接悬浮预览卡。
 *
 * 零 props / 零 emits：状态全在 `useLinkPreview` 单例里，悬浮入口是
 * 正文里构建期生成的 `<a>`（事件委托在 `PageShell`），与 ImageViewer 同构。
 *
 * 交互约定：
 * - 进入 300ms 延迟、离开 200ms 宽限（由组合式函数负责，本组件只渲染）；
 * - `pending` 时显示骨架；provider 拿不到数据时降级成「域名卡」
 *   （preview 仍非 null，只是字段少）；
 * - 数据源各异（GitHub API / bilibili API / 站内数据），卡片版式统一。
 *
 * 与 SearchPanel / ImageViewer 一样 Teleport 到 body：
 * 祖先的 `backdrop-filter` 会为 `position: fixed` 后代创建包含块。
 */

const { preview, visible, pending, anchor, hoverCard, dismiss } = useLinkPreview()

/** 进出状态机：悬浮卡退出极短（80ms），迟滞感比模态浮层小得多。 */
const PREVIEW_EXIT_MS = 80
const { present, exiting } = usePresence(visible, PREVIEW_EXIT_MS)

/** 卡片定位：锚点矩形下方 8px；下方放不下翻转到上方。 */
const position = computed(() => {
  const rect = anchor.value
  if (!rect) return null

  const gap = 8
  const maxCardWidth = 384
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 0
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 0

  // 水平：以链接为中心，夹在视口内（两侧最少留 12px）
  const centerX = rect.x + rect.width / 2
  const left = Math.max(12, Math.min(viewportWidth - maxCardWidth - 12, centerX - maxCardWidth / 2))

  // 垂直：默认下方，放不下翻上方（anchor 只存 x/y/width/height，bottom/top 现算）
  const estimatedHeight = 140
  const below = rect.y + rect.height + gap
  const fitsBelow = below + estimatedHeight < viewportHeight
  const top = fitsBelow ? below : Math.max(12, rect.y - gap - estimatedHeight)

  return { left: `${Math.round(left)}px`, top: `${Math.round(top)}px`, width: `${maxCardWidth}px` }
})

/** 元信息为空时不渲染那一行。 */
const hasMeta = computed(() => Boolean(preview.value?.meta))

/** 是否显示骨架（fetch 中且还没数据）。 */
const showSkeleton = computed(() => pending.value && !preview.value)

/**
 * 允许出现在预览卡上的图标白名单（`IconName` 子集）。
 *
 * provider 写的 icon 是运行期字符串；白名单之外（如将来 provider 拼错）
 * 直接不渲染图标，而不是让一个 undefined 炸掉整张卡。
 */
const PREVIEW_ICONS: ReadonlySet<string> = new Set(['github', 'globe', 'link', 'play'])

const siteIcon = computed<IconName | null>(() => {
  const name = preview.value?.icon
  return name && PREVIEW_ICONS.has(name) ? (name as IconName) : null
})

/* 滚动时收起：锚点矩形失效，卡片会漂到错误位置 */
watch(visible, (isVisible) => {
  if (typeof window === 'undefined') return
  if (isVisible) {
    window.addEventListener('scroll', dismiss, { passive: true, once: true })
  }
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="present"
      class="link-preview"
      :class="{ 'is-exiting': exiting }"
      :style="position ?? undefined"
      role="tooltip"
      @mouseenter="hoverCard"
      @mouseleave="dismiss">
      <!-- 骨架：fetch 中 -->
      <div v-if="showSkeleton" class="link-preview__skeleton" aria-hidden="true">
        <span class="link-preview__sk site"></span>
        <span class="link-preview__sk title"></span>
        <span class="link-preview__sk line"></span>
        <span class="link-preview__sk line short"></span>
      </div>

      <!-- 数据卡（provider 拿不到时字段为空，仍显示域名） -->
      <template v-else-if="preview">
        <p v-if="preview.site" class="link-preview__site">
          <AppIcon v-if="siteIcon" :name="siteIcon" class="link-preview__site-icon" />
          <span>{{ preview.site }}</span>
        </p>
        <p class="link-preview__title">
          <AppIcon
            v-if="!preview.site && siteIcon"
            :name="siteIcon"
            class="link-preview__site-icon" />
          <span>{{ preview.title }}</span>
        </p>
        <p v-if="preview.description" class="link-preview__desc">{{ preview.description }}</p>
        <p v-if="hasMeta" class="link-preview__meta">{{ preview.meta }}</p>
      </template>
    </div>
  </Teleport>
</template>
