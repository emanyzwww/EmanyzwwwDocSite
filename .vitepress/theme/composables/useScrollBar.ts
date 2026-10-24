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
  shouldReveal,
  type ScrollMetrics,
  type ThumbBox,
} from '../support/scrollbar'

/** 页头高度量不出来时的兜底值（宽屏 `--header-height` = 4rem）。 */
const FALLBACK_HEADER = 64

/** 滚动停止多久之后隐藏（毫秒）。 */
const IDLE_DELAY = 1200

/**
 * 右侧「揭示带」宽度（像素）。
 *
 * 比拇指的 14px 命中带更宽，是为了**进入区域就能看见**：
 * 用户的意图往往先表现为「鼠标往右边缘靠」，而不是精准地压在那 6px 上。
 * 24px 落在 `.container` 的 `padding-inline` 之内（桌面 24 / 移动 16），
 * 不会盖住正文里的链接。
 */
const EDGE_ZONE = 24

/** 单调时钟：`performance.now()` 不受系统时间调整影响，更适合算间隔。 */
function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export interface ScrollBarState {
  /** 拇指几何（`length === 0` 表示不该显示）。 */
  thumb: Readonly<Ref<ThumbBox>>
  /** 拇指上沿在视口中的 y 坐标。 */
  top: Readonly<Ref<number>>
  /** 是否有可滚动内容。 */
  visible: Readonly<Ref<boolean>>
  /** 当前是否应当显示（自动隐藏状态）。 */
  shown: Readonly<Ref<boolean>>
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

  /* ---------- 自动隐藏 ---------- */

  const shown = ref(false)
  /** 指针是否在右侧揭示带内。 */
  const pointerInside = ref(false)
  /** 最后一次「用户活动」的时刻（`performance.now()`）。 */
  let lastActivity = Number.NEGATIVE_INFINITY
  let hideTimer = 0
  /** 上次量到的滚动位置，用来区分「真的滚了」和「只是 resize / 首次挂载」。 */
  let lastScrollY = 0

  /** 依据当前状态重算「是否显示」。 */
  function syncShown(): void {
    shown.value =
      visible.value &&
      shouldReveal({
        idleFor: now() - lastActivity,
        pointerInside: pointerInside.value,
        dragging: dragging.value,
        idleDelay: IDLE_DELAY,
      })
  }

  /**
   * 安排到点隐藏。
   *
   * 不用「每次滚动都重置一个 setTimeout 然后立刻改状态」，而是让计时器到点后
   * **重新算一次**：滚动期间 `lastActivity` 一直在刷新，到点时自然还算"活跃"，
   * 于是状态不变、也不会闪。
   */
  function scheduleHide(): void {
    if (hideTimer) {
      window.clearTimeout(hideTimer)
      hideTimer = 0
    }
    if (!shown.value) return
    hideTimer = window.setTimeout(() => {
      hideTimer = 0
      syncShown()
    }, IDLE_DELAY + 16)
  }

  /** 记录一次用户活动：显示并重新计时。 */
  function markActivity(): void {
    lastActivity = now()
    syncShown()
    scheduleHide()
  }

  /* ---------- 测量 ---------- */

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

  /**
   * 滚动回调：几何 + 活动。
   *
   * 只在**滚动位置真的变了**时才算「用户活动」。
   * `useScrollEffect` 在挂载时会立刻回调一次，`resize` 也会触发它；
   * 若不加这个判断，页面一加载滚动条就会闪现一下（而路由切换时
   * `scrollY` 常常都是 0，同样不该闪）。
   */
  function onScroll(): void {
    const y = window.scrollY
    const scrolled = Math.abs(y - lastScrollY) > 0.5
    lastScrollY = y

    measure()
    if (scrolled) markActivity()
    else syncShown()
  }

  lastScrollY = typeof window === 'undefined' ? 0 : window.scrollY
  useScrollEffect(onScroll)

  /** 指针是否进入右侧揭示带（只在跨越边界时更新，避免每帧写 ref）。 */
  function onPointerMove(event: PointerEvent): void {
    /*
     * 只让「能悬停」的指针参与揭示。
     *
     * 触屏没有 hover：手指抬起后**不会**再来一个"移出"事件，
     * `pointerInside` 会永久停在 true，滚动条就再也隐藏不掉了。
     */
    if (event.pointerType === 'touch') return

    const inside = event.clientX >= window.innerWidth - EDGE_ZONE
    if (inside === pointerInside.value) return

    pointerInside.value = inside

    /*
     * 只重算、**不**刷新 `lastActivity`。
     *
     * 若在这里 markActivity，指针扫过右边缘就会把空闲计时重置 1.2 秒，
     * 离开后还留一根幽灵条；而进入时之所以能显示，是因为
     * `shouldReveal` 里 `pointerInside` 已经是强制显示条件，不需要计时。
     * 离开时按"距上次滚动有多久"决定，通常就是立即隐藏。
     */
    syncShown()
  }

  /* ---------- 拖拽 ---------- */

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
    // 拖拽期间必须保持可见，否则指针一离开揭示带拇指就会消失
    markActivity()
    element.setPointerCapture(event.pointerId)

    const onMove = (moveEvent: PointerEvent): void => seek(moveEvent, grabbed)
    const onUp = (): void => {
      dragging.value = false
      element.removeEventListener('pointermove', onMove)
      element.removeEventListener('pointerup', onUp)
      element.removeEventListener('pointercancel', onUp)
      // 松手后回到空闲计时；指针若还在带内则继续显示
      markActivity()
    }

    element.addEventListener('pointermove', onMove)
    element.addEventListener('pointerup', onUp)
    element.addEventListener('pointercancel', onUp)
  }

  onMounted(() => {
    measure()
    // 初始是隐藏的：加载时不闪，滚动或指针靠近才出现
    syncShown()

    /*
     * 盯正文而不是 `<body>`：body 的高度由 flex 撑开，图片加载完未必改变
     * 它的观测盒；正文自身的尺寸变化才真正决定 `scrollHeight`。
     */
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        measure()
        syncShown()
      })
      const article = document.querySelector('[data-article-body]')
      if (article) observer.observe(article)
      observer.observe(document.body)
    }

    /*
     * 揭示带只能在 `window` 上听：容器是 `pointer-events: none` 的，
     * 收不到 `pointerenter`。若把它改成 `auto`，这一条 24px 的竖条就会
     * 挡住正文右边缘的点击 —— 得不偿失。
     *
     * 这个监听只在**跨越边界**时才写状态，平时一次比较就返回。
     */
    window.addEventListener('pointermove', onPointerMove, { passive: true })
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    observer = null
    window.removeEventListener('pointermove', onPointerMove)
    if (hideTimer) window.clearTimeout(hideTimer)
    hideTimer = 0
  })

  return {
    thumb,
    top,
    visible,
    shown,
    active,
    startDrag,
    setHover: (value: boolean) => {
      hovering.value = value
    },
    refresh: () => {
      measure()
      syncShown()
    },
  }
}
