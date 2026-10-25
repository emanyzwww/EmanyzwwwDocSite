/**
 * 目录高亮。
 *
 * 算法：取正文里所有 H2/H3 的几何位置，滚动时找出「最后一个已经越过阅读线」的标题。
 * 阅读线取 `--anchor-offset`（与 CSS 的 `scroll-padding-top` 是同一个变量），
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

/**
 * 阅读线距视口顶部的距离（px）。
 *
 * 直接读 `scroll-padding-top` 的**解析值**（浏览器已把
 * `--anchor-offset` 的 calc 展开成 px），与锚点跳转
 * （`anchor-scroll.ts` 的 `anchorOffset()`）同一个来源 ——
 * 点击目录后高亮必然落在刚跳到的那一项上，不存在两套算法对不齐。
 * 之前这里 parseFloat 自定义属性（拿到的是未解析的 calc 原文）
 * 只能回退 80，移动端页头 3.5rem 时与真实落点差 8px。
 *
 * 读不到时回退到 80px（4rem 页头 + 1rem 余量，16px 根字号）。
 */
const FALLBACK_READING_LINE = 80

function readingLine(): number {
  if (typeof window === 'undefined') return FALLBACK_READING_LINE

  const raw = getComputedStyle(document.documentElement).scrollPaddingTop
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) ? value : FALLBACK_READING_LINE
}

/** 是否已经滚到页面底部（留 2px 容差，避免亚像素误差）。 */
function isAtBottom(): boolean {
  const doc = document.documentElement
  return window.innerHeight + window.scrollY >= doc.scrollHeight - 2
}

export function useActiveAnchor() {
  const { page } = useData()

  /** 当前激活的锚点 id。 */
  const activeId = ref('')

  /** 缓存的标题元素，避免每次滚动都查询 DOM。 */
  let targets: HTMLElement[] = []

  /**
   * 收集正文里的标题元素（由 VitePress 渲染时自动加了 id）。
   *
   * `page.headers` 是**嵌套**结构（H3/H4 挂在父级的 `children` 里），
   * 必须递归展平：只遍历顶层时，深层标题永远进不了 targets，
   * 高亮滚到第一个 H2 之后就不再跟随。
   */
  function collect(): void {
    const flat: { level: number; slug: string }[] = []

    const walk = (
      items: readonly { level: number; slug: string; children?: readonly unknown[] }[],
    ) => {
      for (const item of items) {
        flat.push({ level: item.level, slug: item.slug })
        if (item.children?.length) {
          walk(item.children as { level: number; slug: string; children?: readonly unknown[] }[])
        }
      }
    }

    walk(page.value.headers)

    targets = flat
      .map((header) => document.getElementById(header.slug))
      .filter((element): element is HTMLElement => element !== null)
  }

  /** 计算当前应高亮的标题。 */
  function update(): void {
    if (targets.length === 0) return

    const line = readingLine()
    let current = targets[0]
    for (const target of targets) {
      if (target.getBoundingClientRect().top - line <= 0) current = target
      else break
    }

    /*
     * 页面滚到底时，最后几个标题可能永远越不过阅读线（下方没有足够内容把它们推上去），
     * 此时高亮会卡在中间某一项，读者以为目录坏了。
     * 这里补一条兜底：已经到底就高亮最后一个标题。
     */
    if (isAtBottom()) {
      activeId.value = targets[targets.length - 1]?.id ?? current?.id ?? ''
      return
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
