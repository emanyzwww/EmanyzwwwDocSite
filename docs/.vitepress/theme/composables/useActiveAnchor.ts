/**
 * 目录高亮。
 *
 * 算法：取正文里所有 H2/H3 的几何位置，滚动时找出「最后一个已经越过阅读线」的标题。
 * 阅读线取视口顶部往下约 96px，与 CSS 的 `scroll-padding-top` 呼应，
 * 因此点击目录跳转后高亮也是对的。
 *
 * 为什么不用 IntersectionObserver：
 * 它只在标题进出观察区时回调，长章节内部滚动时不会更新；
 * 且在某些嵌入环境（iframe / 无头浏览器）里行为不稳定。
 * 这里改成「读位置 + 算一遍」，逻辑显式、可测试，代价只是每帧几次布局读取。
 */

import { useData } from 'vitepress'
import { onMounted, ref, watch } from 'vue'

import { useScrollEffect } from '../support/scroll'

/** 阅读线距视口顶部的距离（px）：页头高度 + 一点余量。 */
const READING_LINE = 96

export function useActiveAnchor() {
  const { page } = useData()

  /** 当前激活的锚点 id。 */
  const activeId = ref('')

  /** 缓存的标题元素，避免每次滚动都查询 DOM。 */
  let targets: HTMLElement[] = []

  /** 收集正文里的标题元素（由 VitePress 渲染时自动加了 id）。 */
  function collect(): void {
    targets = page.value.headers
      .map((header) => document.getElementById(header.slug))
      .filter((element): element is HTMLElement => element !== null)
  }

  /** 计算当前应高亮的标题。 */
  function update(): void {
    if (targets.length === 0) return

    let current = targets[0]
    for (const target of targets) {
      if (target.getBoundingClientRect().top - READING_LINE <= 0) current = target
      else break
    }

    activeId.value = current?.id ?? ''
  }

  useScrollEffect(update)

  onMounted(collect)

  watch(
    () => page.value.relativePath,
    () => {
      // 路由切换后内容还没渲染完，等一帧再收集
      window.requestAnimationFrame(() => {
        collect()
        update()
      })
    },
  )

  return { activeId }
}
