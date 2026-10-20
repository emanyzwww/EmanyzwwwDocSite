<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { useLocaleSwitch } from '../../composables/useLocaleSwitch'
import { format, useI18n } from '../../i18n'
import { localizedHref } from '../../support/paths'
import AppIcon from '../common/AppIcon.vue'

/**
 * 语言切换。
 *
 * 行为与旧站一致：一个图标按钮 + 下拉菜单，Esc 关闭、点击外部关闭、
 * 焦点回到触发按钮。目标地址的推导规则见 `useLocaleSwitch`。
 *
 * 点过某个语言后记到 `localStorage`，根路径的自动跳转（`docs/public/index.html`）
 * 会优先尊重这个选择，不再按浏览器语言重新猜一次。
 */

/** 与 `docs/public/index.html` 里必须保持一致的存储键。 */
const LOCALE_STORAGE_KEY = 'emanyzwww-locale'

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
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="root" class="locale-switch" :data-open="open ? 'true' : 'false'">
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
