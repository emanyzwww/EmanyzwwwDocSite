/**
 * 阅读进度。
 *
 * 计算方式：以**正文区域**的滚动进度为准（而不是整页），
 * 因此在「页头 + 页脚 + 侧栏」都存在的三栏布局里更贴近真实阅读位置。
 *
 * 旧站的问题：JS 查找 `[data-reading-progress]`，但没有任何模板输出该元素，
 * 所以进度条从未生效。这里把「元素」和「计算」放在一起，避免再次断链。
 */

import { ref } from 'vue'

import { useScrollEffect } from '../support/scroll'

export function useReadingProgress(target: () => HTMLElement | null) {
  /** 0–1 的进度。 */
  const progress = ref(0)

  useScrollEffect(() => {
    const element = target()
    if (!element) return

    const rect = element.getBoundingClientRect()
    const total = rect.height - window.innerHeight
    // 内容不足一屏时直接视为读完，避免进度条永远停在一条细缝上
    const value = total > 0 ? -rect.top / total : 1
    progress.value = Math.min(1, Math.max(0, value))
  })

  return { progress }
}
