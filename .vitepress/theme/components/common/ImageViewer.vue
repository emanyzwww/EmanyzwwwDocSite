<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { useImageViewer } from '../../composables/useImageViewer'
import { format, useI18n } from '../../i18n'
import { acquireScrollLock, releaseScrollLock, trapFocus } from '../../support/overlay'
import AppIcon from '../common/AppIcon.vue'

/**
 * 图片查看器（全屏浮层）。
 *
 * 零 props / 零 emits：状态全在 `useImageViewer` 这个模块级单例里，
 * 打开入口是正文里的 `<a data-lightbox>`（事件委托在 `PageShell` 里装一次）。
 * 这样正文与查看器之间没有 prop 链，将来正文换成富文本组件也不用改这里。
 *
 * 交互约定：
 * - 打开：点正文图片；`Esc` / 点遮罩 / 点关闭按钮关闭
 * - 翻页：`←` `→`、两侧按钮、缩略图条、触屏左右滑（端点不循环）
 * - 缩放：滚轮、`+` `-`、双击、触屏捏合
 * - 平移：`scale > 1` 时拖动（硬夹取，不回弹、不误翻页）
 * - 实际大小 `1`、适应窗口 `0`、下载原图
 *
 * 与 `SearchPanel` 一样 Teleport 到 body：祖先的 `backdrop-filter` 会为
 * `position: fixed` 后代创建包含块，不 Teleport 会被裁进外壳尺寸。
 */

const { m } = useI18n()

const {
  isOpen,
  items,
  index,
  current,
  scale,
  translate,
  natural,
  stage,
  loading,
  failed,
  gesturing,
  hintVisible,
  canActualSize,
  total,
  close,
  next,
  previous,
  goTo,
  zoomBy,
  toggleZoom,
  actualSize,
  fitToWindow,
  panBy,
  zoomByWheel,
  setScale,
  STEP_RATIO,
} = useImageViewer()

/** 焦点陷阱的根：必须是舞台而不是整个对话框（见下方 `watch`）。 */
const frameEl = ref<HTMLElement | null>(null)
const stageEl = ref<HTMLElement | null>(null)
const closeEl = ref<HTMLButtonElement | null>(null)
const imageEl = ref<HTMLImageElement | null>(null)

/** 焦点陷阱清理函数。 */
let releaseTrap: (() => void) | null = null
/** 打开前聚焦的元素，关闭后要还回去。 */
let previousFocus: HTMLElement | null = null

/**
 * 翻页动画方向。用于给 `.lightbox__fig` 挂 `is-turning-next/prev`。
 */
const turnDirection = ref<'next' | 'prev' | null>(null)

/*
 * 手势判定阈值。
 *
 * - `MOVE_SLOP`：超过它才算「拖动」而不是「轻点」，用来吃掉手指微抖；
 * - `SWIPE_MAX_MS`：超过这个时长仍要够长的位移才算翻页（慢速拖动不是翻页手势）。
 */
const MOVE_SLOP = 8
const SWIPE_MAX_MS = 600

/**
 * 当前图片的两个地址。
 *
 * - `thumb`：正文里那张 672 档 webp，**浏览器已经有缓存**，打开时零延迟
 * - `src`：原图，放大后才看得出差别，体积大得多
 *
 * 两者配合做**渐进加载**：先用缓存好的展示图瞬间填满舞台，
 * 原图在后台静默换上来（见 `loadOrigin`）。这比"直接请求原图、白屏等"
 * 好得多，也比"只看 672 档、放大就糊"好得多 —— 需求里说的
 * "放大应当是完整原图"必须真的加载原图。
 */
const thumbSrc = computed(() => current.value?.thumb ?? '')
const originSrc = computed(() => current.value?.src ?? '')

/** 当前实际渲染的地址。渐进加载完成后换成原图。 */
const displaySrc = ref('')

/** 原图是否已就绪（决定要不要继续显示加载态、以及是否显示"实际像素"）。 */
const originLoaded = ref(false)

/**
 * 实际请求的 `src`：失败重试时追加一个查询参数强制重新请求。
 *
 * 用 `?r=` 而不是改文件名：它不会影响已经缓存成功的那次加载，
 * 也不会让浏览器把同一张图当成两个资源长期留存。
 */
const imageSrc = computed(() => {
  const base = displaySrc.value || thumbSrc.value
  if (!retryToken.value || !base) return base
  return `${base}${base.includes('?') ? '&' : '?'}r=${retryToken.value}`
})

/**
 * 缩放 + 平移的内联 transform。
 *
 * 为什么不写在 CSS 类里：倍率与位移是**连续的手势状态**，
 * 每一帧都在变，只能用内联样式；类名只负责控制 `transition` 的有无
 * （`.is-gesturing`）。两者分工不能混，混了就会出现「拖动时糊成一片」。
 */
const imageTransform = computed(() => ({
  transform: `translate3d(${translate.value.x}px, ${translate.value.y}px, 0) scale(${scale.value})`,
}))

/** 计数文案：`2 / 8`。可见但不给读屏读（语义由 role=status 播报）。 */
const counterText = computed(() => `${index.value + 1} / ${total.value}`)

/** 读屏播报文案。 */
const announcement = computed(() => {
  const item = current.value
  if (!item) return ''
  const position = format(m.value.imageViewerPosition, {
    current: index.value + 1,
    total: total.value,
  })
  return item.alt
    ? format(m.value.imageViewerPositionWithAlt, {
        current: index.value + 1,
        total: total.value,
        alt: item.alt,
      })
    : position
})

/** 缩略图条里每张的小图地址。 */
function thumbStyle(src: string): Record<string, string> {
  return { backgroundImage: `url("${src}")` }
}

/* ------------------------------------------------------------------ *
 * 生命周期：锁滚动 + 焦点陷阱 + 焦点归还
 * ------------------------------------------------------------------ */

watch(isOpen, async (open) => {
  if (typeof document === 'undefined') return

  if (open) {
    /*
     * 焦点归还的目标优先取**触发元素本身**，而不是 `document.activeElement`。
     *
     * 两者在真实点击时通常一致，但键盘回车、程序化点击、以及浏览器差异
     * （某些情况下 mousedown 才转移焦点）都会让 activeElement 落在 body 上，
     * 于是关闭后焦点丢失、读者不得不用 Tab 从头找起。
     * 画廊项里存了 `trigger`，它才是语义上的"打开这张图的那个链接"。
     */
    previousFocus = current.value?.trigger ?? (document.activeElement as HTMLElement | null)
    acquireScrollLock()
    /*
     * 陷阱根用**舞台**，不用整个对话框。
     *
     * 遮罩是个铺满的 button，若以整个对话框为根，Tab 第一站会落在这个
     * 不可见的遮罩上 —— 视觉上焦点凭空消失。舞台里的按钮才是真正的交互项。
     */
    releaseTrap = trapFocus(() => frameEl.value)
    document.addEventListener('keydown', onGlobalKeydown, true)
    await nextTick()
    closeEl.value?.focus()
    measureStage()
  } else {
    releaseScrollLock()
    releaseTrap?.()
    releaseTrap = null
    document.removeEventListener('keydown', onGlobalKeydown, true)
    /*
     * 焦点还给触发元素，且 `preventScroll`。
     *
     * 不 preventScroll 的话，从长文中段打开查看器再关闭，页面会跳回顶部
     * （浏览器的默认滚动到焦点行为）。`MobileNav` 当初也踩过这一处。
     */
    previousFocus?.focus({ preventScroll: true })
    previousFocus = null
  }
})

/** 舞台尺寸变化（窗口缩放 / 横竖屏切换）后重算平移边界。 */
function measureStage(): void {
  const element = stageEl.value
  if (!element) return
  const rect = element.getBoundingClientRect()
  stage.value = { width: rect.width, height: rect.height }
}

/* ------------------------------------------------------------------ *
 * 键盘
 * ------------------------------------------------------------------ */

/**
 * 全局键盘。
 *
 * 用捕获阶段并**不** `stopPropagation`：
 * 这样按 `Ctrl+K` 时，先关掉查看器，事件继续冒泡给 `SearchPanel` 的快捷键，
 * 读者仍然能一次就唤起搜索（否则会出现「先按 Esc 再按 Ctrl+K」的额外一步）。
 */
function onGlobalKeydown(event: KeyboardEvent): void {
  if (!isOpen.value) return

  switch (event.key) {
    case 'Escape':
      event.preventDefault()
      close()
      return

    case 'ArrowRight':
      event.preventDefault()
      goNext()
      return

    case 'ArrowLeft':
      event.preventDefault()
      goPrevious()
      return

    case 'Home':
      event.preventDefault()
      goTo(0)
      return

    case 'End':
      event.preventDefault()
      goTo(total.value - 1)
      return

    case '+':
    case '=':
      event.preventDefault()
      zoomBy(STEP_RATIO)
      return

    case '-':
      event.preventDefault()
      zoomBy(1 / STEP_RATIO)
      return

    case '0':
      event.preventDefault()
      fitToWindow()
      return

    case '1':
      event.preventDefault()
      actualSize()
      return

    default:
      // Ctrl/⌘+K：让位给搜索（见上面的注释）
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) close()
  }
}

/* ------------------------------------------------------------------ *
 * 滚轮缩放
 * ------------------------------------------------------------------ */

/**
 * 滚轮**不需要按 Ctrl**。
 *
 * 网页里「Ctrl + 滚轮缩放」的惯例是为了不抢走页面滚动；而查看器打开时
 * 页面已经被滚动锁冻结，滚轮没有别的用途，再加一个修饰键只是多一步。
 *
 * 触控板的双指捏合在 Chrome 里会合成带 `ctrlKey` 的 wheel 事件，
 * 这里同样按缩放处理 —— 正好符合直觉。
 */
function onWheel(event: WheelEvent): void {
  event.preventDefault()

  // 横向滚动是「想平移」，忽略；纵向才缩放
  if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return

  // deltaMode 1 = 按行（Firefox），换算成近似像素
  const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY
  const rect = stageEl.value?.getBoundingClientRect()
  const anchor = rect
    ? {
        x: event.clientX - rect.left - rect.width / 2,
        y: event.clientY - rect.top - rect.height / 2,
      }
    : undefined

  zoomByWheel(delta, anchor)
}

/* ------------------------------------------------------------------ *
 * 指针手势：拖动平移 / 滑动翻页 / 捏合缩放 / 双击
 * ------------------------------------------------------------------ */

interface PointerRecord {
  x: number
  y: number
}

/** 按 pointerId 记录的触点。 */
const pointers = new Map<number, PointerRecord>()

/** 手势开始时的快照。 */
let gestureStart: {
  time: number
  scale: number
  x: number
  y: number
  /** 捏合起始的两指距离。 */
  pinchDistance: number
  /** 是否已经判定为手势（超过 slop）。 */
  moved: boolean
} | null = null

/** 最后一次点击的时间与位置，用于双击判定。 */
let lastTap = { time: 0, x: 0, y: 0 }

function distanceOf(a: PointerRecord, b: PointerRecord): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function onPointerDown(event: PointerEvent): void {
  const element = event.currentTarget as HTMLElement | null
  // 只处理主键 / 触摸 / 笔
  if (event.button !== 0 && event.pointerType === 'mouse') return

  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  element?.setPointerCapture?.(event.pointerId)

  if (pointers.size === 1) {
    gestureStart = {
      time: performance.now(),
      scale: scale.value,
      x: event.clientX,
      y: event.clientY,
      pinchDistance: 0,
      moved: false,
    }
    gesturing.value = true
  } else if (pointers.size === 2 && gestureStart) {
    const [a, b] = [...pointers.values()]
    gestureStart.pinchDistance = distanceOf(a, b)
    // 捏合期间不参与滑动判定，避免捏到一半被误认为翻页
    gestureStart.moved = true
  }
}

function onPointerMove(event: PointerEvent): void {
  const start = gestureStart
  if (!start || !pointers.has(event.pointerId)) return

  // 名字带 Last 后缀：`previous` 是查看器的"上一张"动作，这里不能同名
  const lastPoint = pointers.get(event.pointerId)
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  if (!lastPoint) return

  // 捏合：按两指距离的比例缩放
  if (pointers.size === 2 && start.pinchDistance > 0) {
    const [a, b] = [...pointers.values()]
    const ratio = distanceOf(a, b) / start.pinchDistance
    const target = start.scale * ratio
    setScale(target)

    // 捏合到接近 1 以下就回弹到 fit（去掉「卡在 1.02 倍」的尴尬）
    if (target < 1.05) {
      start.pinchDistance = distanceOf(a, b)
      start.scale = scale.value
    }
    return
  }

  const dx = event.clientX - lastPoint.x
  const dy = event.clientY - lastPoint.y

  // 超过 slop 才算手势，避免手指微抖就把轻点判成拖动
  if (!start.moved) {
    const travelled = Math.hypot(event.clientX - start.x, event.clientY - start.y)
    if (travelled > MOVE_SLOP) start.moved = true
  }

  /*
   * `scale > 1` 一律平移，不做翻页判定。
   *
   * 这是「拖动看局部」与「滑动翻页」冲突时唯一可靠的判据：
   * 放大之后读者的意图必然是看局部，误翻页的代价（丢失当前位置）远高于拖不动。
   */
  if (scale.value > 1) panBy(dx, dy)
}

function onPointerUp(event: PointerEvent): void {
  const start = gestureStart
  pointers.delete(event.pointerId)

  if (!start) return

  // 还有手指在屏幕上：继续手势，但把基准点更新成剩下的那根
  if (pointers.size > 0) {
    const [first] = [...pointers.values()]
    gestureStart = { ...start, x: first.x, y: first.y, pinchDistance: 0 }
    return
  }

  gesturing.value = false
  gestureStart = null

  const elapsed = performance.now() - start.time
  const dx = event.clientX - start.x
  const dy = event.clientY - start.y

  // 没超过 slop：当作点击，做双击判定
  if (!start.moved) {
    const now = performance.now()
    const isDouble =
      now - lastTap.time < 300 &&
      Math.abs(event.clientX - lastTap.x) < 24 &&
      Math.abs(event.clientY - lastTap.y) < 24

    if (isDouble) {
      const rect = stageEl.value?.getBoundingClientRect()
      const anchor = rect
        ? {
            x: event.clientX - rect.left - rect.width / 2,
            y: event.clientY - rect.top - rect.height / 2,
          }
        : undefined
      toggleZoom(anchor)
      lastTap = { time: 0, x: 0, y: 0 }
      return
    }

    lastTap = { time: now, x: event.clientX, y: event.clientY }
    return
  }

  // 已经放大：拖动到边界就是停住，不做任何"回弹"或翻页
  if (start.scale > 1.01 || scale.value > 1.01) return

  /*
   * 翻页判定（仅在 fit 状态）：
   * - 位移 ≥ max(48px, 12% 视口宽)
   * - 横向占优（1.5 倍）
   * - 够快（600ms 内）；慢速拖动需要更长的位移才算
   */
  const threshold = Math.max(48, window.innerWidth * 0.12)
  const horizontal = Math.abs(dx) > Math.abs(dy) * 1.5
  const fast = elapsed < SWIPE_MAX_MS || Math.abs(dx) > threshold * 2.5

  if (!horizontal || Math.abs(dx) < threshold || !fast) return

  if (dx < 0) {
    goNext()
  } else {
    goPrevious()
  }
}

function onPointerCancel(): void {
  pointers.clear()
  gestureStart = null
  gesturing.value = false
}

/* ------------------------------------------------------------------ *
 * 图片加载（渐进式：先展示图，再原图）
 * ------------------------------------------------------------------ */

/** 当前解码出来的原图对象。换图/关闭时中断。 */
let originProbe: HTMLImageElement | null = null

/** 中断原图预载（换图、关闭、卸载都要调，避免回调打在过期对象上）。 */
function abortOriginProbe(): void {
  if (!originProbe) return
  // 用一个必定不会触发的 src 结束未完成的请求（清空引用即可让回调里的守卫生效）
  originProbe = null
}

/**
 * 先用已缓存的展示图瞬间填满舞台，再在后台把**原图**换上来。
 *
 * 需求里的"放大应当是完整原图"必须真的加载原图，否则 1:1 就是插值糊。
 * 但直接请求原图（实测 1.87 MB）会白屏等好几百毫秒，
 * 所以分两步：展示图先到，原图后到并静默替换。
 */
function loadOrigin(): void {
  // 中断上一次未完成的原图加载（快速翻页时会有）
  abortOriginProbe()

  displaySrc.value = thumbSrc.value
  originLoaded.value = false

  const target = originSrc.value
  if (!target || target === thumbSrc.value) {
    // 没有独立原图（矢量 / 单档图）：展示图即最终图
    originLoaded.value = true
    return
  }

  const probe = new Image()
  originProbe = probe

  /*
   * 用 `addEventListener` 而不是 `onload =`：
   * 后者只能挂一个，且清空时要把属性赋 null（lint 也不建议这么写）。
   * 这里 `once: true` 让监听器自己退出，无需手动解绑。
   */
  probe.addEventListener(
    'load',
    () => {
      if (originProbe !== probe) return
      originProbe = null
      // 原图比展示图还小的话没有意义，保持展示图（避免"放大反而更糊"）
      const bigger =
        probe.naturalWidth * probe.naturalHeight >=
        (imageEl.value?.naturalWidth ?? 0) * (imageEl.value?.naturalHeight ?? 0)
      if (!bigger) {
        originLoaded.value = true
        return
      }
      displaySrc.value = target
    },
    { once: true },
  )

  probe.addEventListener(
    'error',
    () => {
      // 原图取不到不影响阅读：继续用展示图（静默降级，不打断读者）
      if (originProbe !== probe) return
      originProbe = null
      originLoaded.value = true
    },
    { once: true },
  )

  probe.src = target
}

function onImageLoad(event: Event): void {
  const image = event.target as HTMLImageElement
  natural.value = { width: image.naturalWidth, height: image.naturalHeight }
  loading.value = false
  measureStage()
  // 展示图到位后立刻可以操作；原图仍在后台加载
  originLoaded.value = true
}

function onImageError(): void {
  /*
   * 展示图（672 档）失败才算真失败。
   *
   * 原图单独失败由 `loadOrigin` 里的 `probe.onerror` 处理：
   * 那时页面上已经有展示图，不该弹"加载失败"。
   */
  if (displaySrc.value && displaySrc.value !== thumbSrc.value) {
    // 是原图替换失败 → 退回展示图重来一次，不打断读者
    displaySrc.value = thumbSrc.value
    originLoaded.value = true
    return
  }

  natural.value = { width: 0, height: 0 }
  loading.value = false
  failed.value = true
}

/** 失败态重试：换一个查询参数强制浏览器重新请求。 */
const retryToken = ref(0)
function retry(): void {
  failed.value = false
  loading.value = true
  retryToken.value += 1
  loadOrigin()
}

/** 翻页（带方向，用于播放对应方向的动画）。 */
function goNext(): void {
  playTurn('next')
  next()
}

function goPrevious(): void {
  playTurn('prev')
  previous()
}

/**
 * 触发翻页动画。
 *
 * 必须**先清空再设置**，两个理由：
 *
 * 1. 类名从 `'next'` 改成 `'next'` 时 Vue 不会更新 DOM，于是连按时第二次
 *    就没有动画了；
 * 2. `prefers-reduced-motion` 下动画是 `animation: none`，`animationend`
 *    永远不触发，`turnDirection` 会一直残留。
 *
 * 用 `nextTick` 而不是 `requestAnimationFrame`：前者保证 Vue 已把这次变化
 * 刷进 DOM，后者只是"下一帧"，快速连按时两者会打架。
 */
function playTurn(direction: 'next' | 'prev'): void {
  turnDirection.value = null
  void nextTick(() => {
    turnDirection.value = direction
  })
}

/** 打开期间窗口尺寸变化（含横竖屏切换）。 */
function onResize(): void {
  if (!isOpen.value) return
  measureStage()
}

onMounted(() => {
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  // 卸载时无条件释放：路由切换销毁组件时锁会残留
  releaseScrollLock()
  releaseTrap?.()
  releaseTrap = null
  document.removeEventListener('keydown', onGlobalKeydown, true)
})

/**
 * 换图（打开 / 翻页）后重新走一遍渐进加载。
 *
 * `immediate: true` 让"打开查看器"这一刻也触发 —— 组件的 `v-if` 在
 * `isOpen` 变 true 时挂载，`index` 的初始变化不会再次触发 watch。
 */
watch(
  [isOpen, index],
  ([open]) => {
    if (!open) return
    loading.value = !failed.value
    // 提示在翻过一页后淡出：读者已经知道有翻页了
    hintVisible.value = false
    loadOrigin()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  // 卸载时中断原图加载：回调里的 `originProbe !== probe` 守卫会因此失效退出
  abortOriginProbe()
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      class="lightbox"
      role="dialog"
      aria-modal="true"
      :aria-label="m.imageViewer"
      @wheel.prevent="onWheel">
      <!-- 遮罩：铺满的 button，点它关闭（与 SearchPanel 的 scrim 同一做法） -->
      <button
        class="lightbox__scrim"
        type="button"
        :aria-label="m.imageViewerClose"
        @click="close" />

      <div ref="frameEl" class="lightbox__frame">
        <div class="lightbox__bar">
          <span class="lightbox__counter" aria-hidden="true">{{ counterText }}</span>
          <span class="lightbox__name">{{ current?.name }}</span>

          <div class="lightbox__actions">
            <button
              class="lightbox__action"
              type="button"
              :aria-label="m.imageViewerZoomOut"
              :disabled="scale <= 1.01"
              @click="zoomBy(1 / STEP_RATIO)">
              <AppIcon name="zoom-out" />
            </button>
            <button
              class="lightbox__action"
              type="button"
              :aria-label="m.imageViewerZoomIn"
              @click="zoomBy(STEP_RATIO)">
              <AppIcon name="zoom-in" />
            </button>
            <button
              v-if="canActualSize"
              class="lightbox__action"
              type="button"
              :aria-label="m.imageViewerActualSize"
              :title="m.imageViewerActualSize"
              @click="actualSize">
              <AppIcon name="fit" />
            </button>
            <a
              v-if="current?.src"
              class="lightbox__action"
              :href="current.src"
              :download="current.name || undefined"
              :aria-label="m.imageViewerDownload"
              :title="m.imageViewerDownload">
              <AppIcon name="download" />
            </a>
            <button
              ref="closeEl"
              class="lightbox__action"
              type="button"
              :aria-label="m.imageViewerClose"
              @click="close">
              <AppIcon name="close" />
            </button>
          </div>
        </div>

        <div
          ref="stageEl"
          class="lightbox__stage"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerCancel">
          <div
            class="lightbox__fig"
            :class="{
              'is-loading': loading,
              'is-turning-next': turnDirection === 'next',
              'is-turning-prev': turnDirection === 'prev',
            }"
            @animationend="turnDirection = null">
            <img
              ref="imageEl"
              class="lightbox__image"
              :class="{ 'is-gesturing': gesturing }"
              :style="imageTransform"
              :src="imageSrc"
              :alt="current?.alt ?? ''"
              draggable="false"
              @load="onImageLoad"
              @error="onImageError" />
          </div>

          <p v-if="loading" class="lightbox__status">
            <span class="lightbox__status-text">{{ m.imageViewerLoading }}</span>
          </p>

          <div v-else-if="failed" class="lightbox__status lightbox__status--failed" role="alert">
            <span class="lightbox__status-text">{{ m.imageViewerFailed }}</span>
            <button class="lightbox__retry" type="button" @click="retry">
              {{ m.imageViewerRetry }}
            </button>
            <a
              class="lightbox__fallback"
              :href="current?.src"
              target="_blank"
              rel="noreferrer noopener">
              {{ m.imageViewerOpenOriginal }}
            </a>
          </div>

          <button
            class="lightbox__nav lightbox__nav--prev"
            type="button"
            :aria-label="m.imageViewerPrevious"
            :disabled="index <= 0"
            @click="goPrevious">
            <AppIcon name="arrow-left" />
          </button>
          <button
            class="lightbox__nav lightbox__nav--next"
            type="button"
            :aria-label="m.imageViewerNext"
            :disabled="index >= total - 1"
            @click="goNext">
            <AppIcon name="arrow-right" />
          </button>
        </div>

        <p v-if="hintVisible" class="lightbox__hint">{{ m.imageViewerHint }}</p>

        <div
          v-if="total > 1"
          class="lightbox__strip"
          :aria-label="m.imageViewerThumbs"
          role="group">
          <button
            v-for="(item, itemIndex) in items"
            :key="item.key || item.src"
            class="lightbox__thumb"
            type="button"
            :style="thumbStyle(item.thumb)"
            :aria-label="format(m.imageViewerPosition, { current: itemIndex + 1, total })"
            :aria-current="itemIndex === index ? 'true' : 'false'"
            @click="goTo(itemIndex)" />
        </div>
      </div>

      <!-- 读屏播报源：可见计数是给视觉读者的，语义由这里承担 -->
      <p class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {{ announcement }}
      </p>
    </div>
  </Teleport>
</template>
