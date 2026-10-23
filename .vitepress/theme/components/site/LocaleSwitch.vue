<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { useLocaleSwitch } from '../../composables/useLocaleSwitch'
import { format, useI18n } from '../../i18n'
import { localizedHref } from '../../support/paths'
import AppIcon from '../common/AppIcon.vue'

/**
 * 语言切换。
 *
 * 两种形态，由 `variant` 决定：
 *
 * - `dropdown`（桌面页头默认）：一个图标按钮 + 下拉菜单。
 *   Esc 关闭、点击外部关闭、焦点回到触发按钮。
 *
 * - `segmented`（移动端抽屉里用）：两个并排的分段按钮，
 *   当前语言高亮、另一语言可点。**没有展开过程**，一次点击就完成切换。
 *
 * 为什么抽屉里必须用 `segmented` 而不是 `dropdown`：
 * 抽屉面板是 `overflow-y: auto` 的滚动容器，而下拉菜单是
 * `position: absolute` —— 它会被滚动容器**直接裁掉**，
 * 即使滚动到位置也弹不出来。这个 bug 在旧实现里存在但很难被发现
 * （表现为「点了没反应」）。分段按钮从结构上消除了这个问题。
 *
 * 两种形态共用同一份地址推导逻辑（`useLocaleSwitch`），
 * 也共用同一个 `localStorage` 记忆键。
 */

/** 与 `public/index.html` 里必须保持一致的存储键。 */
const LOCALE_STORAGE_KEY = 'emanyzwww-locale'

const props = withDefaults(
  defineProps<{
    /** 展现形态。`dropdown` 用于桌面，`segmented` 用于移动端抽屉。 */
    variant?: 'dropdown' | 'segmented'
  }>(),
  { variant: 'dropdown' },
)

const { m, locale } = useI18n()
const { options } = useLocaleSwitch()

const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const open = ref(false)

const currentLabel = computed(() => options.value.find((option) => option.current)?.label ?? '')

const triggerLabel = computed(() =>
  format(m.value.switchLanguageCurrent, { language: currentLabel.value }),
)

/** 触发按钮只显示当前语言的专属图标（「中」或「A」）。 */
const currentIcon = computed(() => (locale.value === 'en' ? 'en' : 'zh'))

/** 记住用户的选择（隐私模式下会抛错，忽略即可）。 */
function remember(code: string): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, code)
  } catch {
    // localStorage 不可用时只是失去记忆功能，不影响跳转
  }
}

function toggle(): void {
  open.value = !open.value
}

function close(): void {
  open.value = false
}

function onDocumentClick(event: MouseEvent): void {
  if (!root.value?.contains(event.target as Node)) close()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !open.value) return
  // 只在焦点还在组件内时处理，避免抢走页面上其它 Esc 行为
  if (!root.value?.contains(document.activeElement)) return
  close()
  trigger.value?.focus()
}

onMounted(() => {
  // 分段形态没有展开状态，不需要任何全局监听
  if (props.variant === 'segmented') return
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <!-- ---------- 分段形态（移动端抽屉） ---------- -->
  <div
    v-if="variant === 'segmented'"
    class="locale-seg"
    role="group"
    :aria-label="m.switchLanguage">
    <template v-for="option in options" :key="option.code">
      <!-- 当前语言：不可点，用 aria-current 标记 -->
      <span
        v-if="option.current"
        class="locale-seg__btn is-current"
        :lang="option.lang"
        aria-current="true">
        <AppIcon :name="option.code === 'en' ? 'en' : 'zh'" />
        {{ option.label }}
      </span>

      <!-- 另一种语言：一次点击直达对应页面 -->
      <a
        v-else
        class="locale-seg__btn"
        :href="localizedHref(option.url)"
        :hreflang="option.lang"
        :lang="option.lang"
        @click="remember(option.code)">
        <AppIcon :name="option.code === 'en' ? 'en' : 'zh'" />
        {{ option.label }}
      </a>
    </template>
  </div>

  <!-- ---------- 下拉形态（桌面页头） ---------- -->
  <div v-else ref="root" class="locale-switch" :data-open="open ? 'true' : 'false'">
    <button
      ref="trigger"
      class="locale-switch__trigger icon-button"
      type="button"
      aria-haspopup="true"
      :aria-expanded="open ? 'true' : 'false'"
      :aria-label="triggerLabel"
      :title="m.switchLanguage"
      @click.stop="toggle">
      <AppIcon :name="currentIcon" />
    </button>

    <ul class="locale-switch__menu">
      <li v-for="option in options" :key="option.code">
        <span v-if="option.current" aria-current="true">
          <AppIcon :name="option.code === 'en' ? 'en' : 'zh'" />
          {{ option.label }}
        </span>
        <a
          v-else
          :href="localizedHref(option.url)"
          :hreflang="option.lang"
          :lang="option.lang"
          @click="remember(option.code)">
          <AppIcon :name="option.code === 'en' ? 'en' : 'zh'" />
          {{ option.label }}
        </a>
      </li>
    </ul>
  </div>
</template>
