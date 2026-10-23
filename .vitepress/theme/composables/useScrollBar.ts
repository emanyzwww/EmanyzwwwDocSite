/**
 * 自绘滚动条的测量与拖拽。
 *
 * ---------- 为什么是「自绘」而不是美化原生 ----------
 *
 * 原生滚动条能改的只有宽度和颜色（`scrollbar-width` / `scrollbar-color`，
 * 或 WebKit 那几个 `::-webkit-scrollbar*` 伪元素）。有四件做不到的事：
 *
 * 1. **长度下限**——原生拇指长度由浏览器按比例算，长文章里会细成一条缝；
 * 2. **避开页头**——原生条只能贴视口上下沿，滚到顶部时会被粘性页头压住；
 * 3. **槽底与画布一致**——Chromium 的 `::-webkit-scrollbar-track` 无法与
 *    `--bg-canvas` 完全一致（暗色下尤其明显），始终是一根「系统条」；
 * 4. **层级**——原生滚动条永远在内容之上，且无法排到页头之下。
 *
 * 所以彻底不显示原生条（见 `base.css` 的说明），改画一个与设计系统同源的浮层拇指。
 *
 * ---------- 为什么复用 `useScrollEffect` ----------
 *
 * 位置由滚动位置直接映射（`support/scrollbar.ts` 的纯函数），因此必须随滚动更新。
 * 全站只有 `support/scroll.ts` 一处监听 `scroll` / `resize`，并且已经做了
 * rAF 合并与超时兜底；这里再 addEventListener 一份只会重复计算。
 *
 * 另外用 `ResizeObserver` 盯正文：图片加载完、字体切换、窗口缩放都会改变
 * 文档高度，而它们**不一定**伴随滚动事件 —— 只靠 scroll 会让拇指长度停在旧值。
 */

import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

import { useScrollEffect } from '../support/scroll'
import {
  computeThumb,
  scrollTopForOffset,
  type ScrollMetrics,
  type ThumbBox,
} from '../support/scrollbar'

/** 页头高度量不出来时的兜底值（宽屏 `--header-height` = 4rem）。 */
const FALLBACK_HEADER = 64

export interface ScrollBarState {
  /** 拇指几何（`length === 0` 表示不该显示）。 */
  thumb: Readonly<Ref<ThumbBox>>
  /** 拇指上沿在视口中的 y 坐标。 */
  top: Readonly<Ref<number>>
  /** 是否有可滚动内容。 */
  visible: Readonly<Ref<boolean>>
  /** 是否正在悬停或拖拽（用于加深颜色）。 */
  active: Readonly<Ref<boolean>>
  /** 指针按下：开始拖拽。 */
  startDrag: (event: PointerEvent) => void
  /** 指针进入 / 离开拇指。 */
  setHover: (value: boolean) => void
  /**
   * 强制重测。
   *
   * 路由切换后**必须**调用：`ScrollBar` 挂在常驻的 `PageShell` 上，
   * 从长文章跳到短页面时，`scrollY` 可能一直是 0（没有 scroll 事件），
   * 唯一的变化是文档变短了。只靠 ResizeObserver 也能覆盖大部分情况，
   * 但那是「正文高度恰好变了」的副作用，不是显式契约。
   */
  refresh: () => void
}

/**
 * @param pageHeader 取页头元素；用于量轨道上沿与拇指长度下限。
 */
export function useScrollBar(pageHeader: () => HTMLElement | null): ScrollBarState {
  const thumb = ref<ThumbBox>({ length: 0, offset: 0, track: 0, maxScroll: 0 })
  const top = ref(0)
  const visible = ref(false)
  const hovering = ref(false)
  /** 拖拽中强制加深：拖拽时指针可能已经离开拇指，`:hover` 就失效了。 */
  const dragging = ref(false)

  const active = computed(() => hovering.value || dragging.value)

  let observer: ResizeObserver | null = null

  /** 页头下沿（= 轨道上沿）；阅读态下页头移出屏幕，夹到 0。 */
  function headerBottom(): number {
    return Math.max(0, pageHeader()?.getBoundingClientRect().bottom ?? 0)
  }

  /** 页头高度 = 拇指长度下限。量不到时用令牌兜底值。 */
  function headerHeight(): number {
    const height = pageHeader()?.getBoundingClientRect().height ?? 0
    return height > 0 ? height : FALLBACK_HEADER
  }

  /** 量一次，重算几何。 */
  function measure(): void {
    const doc = document.documentElement
    const viewport = doc.clientHeight
    const trackTop = headerBottom()

    const metrics: ScrollMetrics = {
      viewport,
      content: doc.scrollHeight,
      trackTop,
      trackBottom: viewport,
      /*
       * 长度下限 = 页头高度。
       *
       * 这不只是「好看」：轨道从页头下沿开始，如果拇指只有十几像素，
       * 它看起来就是页头下边框的一部分，用户根本注意不到它、也拖不准。
       * 与页头等高之后，拇指在任何页面上都有同一个视觉重量。
       */
      minThumb: headerHeight(),
    }

    const box = computeThumb(metrics, window.scrollY)
    thumb.value = box
    top.value = trackTop + box.offset
    visible.value = box.maxScroll > 1
  }

  useScrollEffect(measure)

  /** 拖拽中每个 pointermove 的换算。 */
  function seek(event: PointerEvent, grabbed: number): void {
    const box = thumb.value
    if (box.maxScroll <= 0) return

    // 指针位置 → 拇指上沿应有的位置 → 轨道内偏移
    const offset = event.clientY - grabbed - headerBottom()
    window.scrollTo({ top: scrollTopForOffset(box, offset), behavior: 'instant' })
  }

  function startDrag(event: PointerEvent): void {
    // 只响应主键；右键/中键不该拖动滚动条
    if (event.button !== 0) return
    if (thumb.value.maxScroll <= 0) return

    // 阻止文本选择与原生拖拽（滚动条不在选区语义里）
    event.preventDefault()

    const element = event.currentTarget as HTMLElement
    /*
     * 记下「指针在拇指内的相对位置」。
     *
     * 不记的话每次移动都会把拇指上沿吸到指针处，按在拇指下半部往下拖时
     * 拇指会先往上跳一下 —— 这正是自制滚动条最容易露馅的地方。
     */
    const grabbed = event.clientY - top.value

    dragging.value = true
    element.setPointerCapture(event.pointerId)

    const onMove = (moveEvent: PointerEvent): void => seek(moveEvent, grabbed)
    const onUp = (): void => {
      dragging.value = false
      element.removeEventListener('pointermove', onMove)
      element.removeEventListener('pointerup', onUp)
      element.removeEventListener('pointercancel', onUp)
    }

    element.addEventListener('pointermove', onMove)
    element.addEventListener('pointerup', onUp)
    element.addEventListener('pointercancel', onUp)
  }

  onMounted(() => {
    measure()

    /*
     * 盯正文而不是 `<body>`：body 的高度由 flex 撑开，图片加载完未必改变
     * 它的观测盒；正文自身的尺寸变化才真正决定 `scrollHeight`。
     */
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => measure())
      const article = document.querySelector('[data-article-body]')
      if (article) observer.observe(article)
      observer.observe(document.body)
    }
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    observer = null
  })

  return {
    thumb,
    top,
    visible,
    active,
    startDrag,
    setHover: (value: boolean) => {
      hovering.value = value
    },
    refresh: measure,
  }
}
