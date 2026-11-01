<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

import { useI18n } from '../../i18n'

/**
 * 文末动作条：复制本页链接 / 系统分享。
 *
 * 两条纪律：
 *
 * 1. **零第三方**。不接任何分享平台 SDK，也不生成平台图标：
 *    移动端走 `navigator.share`（系统原生分享面板），桌面端没有这个能力时
 *    只留「复制链接」——复制出来的地址可以粘到任何地方，比一排品牌按钮安静得多。
 * 2. **反馈不新建浮层**。复制成功后按钮文案直接切「已复制」两秒，
 *    与代码块复制按钮同一套做法（不引入 toast / 提示条）。
 *
 * 「分享」按钮只在浏览器真的支持 `navigator.share` 时渲染。
 * 能力探测放在 `onMounted` 里而不是 `computed` 里：构建期（SSR）没有
 * `navigator`，若在那里也算出一个 `true`，水合时 DOM 与 SSR 输出对不上。
 */

const { m } = useI18n()

/** 复制成功的临时状态（2 秒后回退）。 */
const copied = ref(false)
/** 是否支持系统分享面板（挂载后才探测，保证 SSR 输出稳定）。 */
const shareSupported = ref(false)
let resetTimer: ReturnType<typeof setTimeout> | null = null

function flashCopied(): void {
  copied.value = true
  if (resetTimer !== null) clearTimeout(resetTimer)
  resetTimer = setTimeout(() => {
    copied.value = false
    resetTimer = null
  }, 2000)
}

/**
 * 复制文本。优先 Clipboard API（需要安全上下文），失败时退回
 * `textarea + execCommand`（老浏览器 / 非 HTTPS 的本地预览）。
 */
async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return
    }
  } catch {
    // 落到下面的兜底
  }

  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.top = '0'
  area.style.opacity = '0'
  document.body.append(area)
  area.select()
  try {
    document.execCommand('copy')
  } catch {
    // 复制失败也不报错：读者可以手动从地址栏复制
  }
  area.remove()
}

async function onCopy(): Promise<void> {
  await copyText(window.location.href)
  flashCopied()
}

/**
 * 分享。
 *
 * 读者在系统面板里按「取消」也会走到 `reject`，那不是错误、也不该兜底复制
 * （取消是明确意图）。因此这里**只吞掉异常，不做任何降级动作**。
 */
async function onShare(): Promise<void> {
  try {
    await navigator.share({ title: document.title, url: window.location.href })
  } catch {
    // 用户取消 / 系统不允许：什么都不做
  }
}

onMounted(() => {
  shareSupported.value = typeof navigator.share === 'function'
})

onBeforeUnmount(() => {
  if (resetTimer !== null) clearTimeout(resetTimer)
})
</script>

<template>
  <div class="post-actions">
    <button class="btn" type="button" @click="onCopy">
      {{ copied ? m.copied : m.copyLink }}
    </button>
    <button v-if="shareSupported" class="btn" type="button" @click="onShare">
      {{ m.share }}
    </button>
    <!-- 文案变化对读屏不可靠，用 role="status" 播报一次 -->
    <span class="visually-hidden" role="status">{{ copied ? m.copied : '' }}</span>
  </div>
</template>
