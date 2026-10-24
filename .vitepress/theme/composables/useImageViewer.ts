/**
 * 图片查看器状态机（模块级单例）。
 *
 * ## 为什么是单例
 *
 * 与 `useDockState` 同一个理由：`PageShell` 挂一份查看器、正文里的
 * `<a data-lightbox>` 只需要「请求打开某一张」，两边必须看到同一份状态。
 * 如果每个调用点各建一份 ref，就会出现「点了图但查看器不弹」这种
 * 谁也没写错的 bug。
 *
 * ## 画廊从哪里来
 *
 * **当前文章内**的全部可放大图片，按 DOM 顺序。不是全站、也不是"当前目录"：
 * 跨文章翻页会让读者不知道自己翻到哪了，而"这一篇的配图"是自洽的一组。
 *
 * 每次打开都从 DOM 重新扫描一遍（`document.querySelectorAll`），而不是缓存在
 * 模块里 —— 路由切换后 DOM 全换，缓存必然过期，而扫描的成本是几十微秒。
 */

import { computed, readonly, ref, shallowRef } from 'vue'

/** 画廊里的一张图。 */
export interface LightboxItem {
  /** 原图地址（`<a href>`）。 */
  src: string
  /** 展示用地址（`<img src>`，通常是 672 档）。 */
  thumb: string
  /** 替代文本；为空时播报会用 `imageViewerPosition` 而不是带 alt 的那句。 */
  alt: string
  /** 下载时的默认文件名（来自 `data-origin-name`）。 */
  name: string
  /** 内容指纹，用于去重（同一张图在正文里出现两次只算一张）。 */
  key: string
  /** 触发元素，关闭后焦点要还给它。 */
  trigger: HTMLElement | null
}

/** 缩放上限的兜底（原图很大时按实际像素算，见 `maxScale`）。 */
const HARD_MAX_SCALE = 8

/** 双击在 fit 与这个倍率之间切换。 */
const DOUBLE_TAP_SCALE = 2

/** 键盘/双击缩放的步进倍率。 */
const STEP_RATIO = 1.4

/** 滚轮灵敏度。`exp(-delta * K)` 比线性更接近触控板的手感。 */
const WHEEL_K = 0.0015

/** 单例状态。 */
const open = ref(false)
const items = shallowRef<LightboxItem[]>([])
const index = ref(0)

/** 当前缩放倍率（1 = 适应窗口）。 */
const scale = ref(1)
/** 平移量（仅 `scale > 1` 时有意义），单位 CSS px。 */
const translate = ref({ x: 0, y: 0 })

/** 原图固有尺寸，用于算 1:1 与平移边界。 */
const natural = ref({ width: 0, height: 0 })
/** 舞台尺寸，用于算 fit 与边界。 */
const stage = ref({ width: 0, height: 0 })

const loading = ref(false)
const failed = ref(false)

/** 手势进行中：期间关掉 CSS transition。 */
const gesturing = ref(false)

/** 首次打开才显示键盘提示，用过一次就藏（避免长期占位）。 */
const hintVisible = ref(true)

const current = computed(() => items.value[index.value] ?? null)

/**
 * 舞台内"适应窗口"时图片的显示尺寸。
 *
 * `natural` 在图片 `load` 之后才有值；在那之前按 1×1 兜底，
 * 避免除零（计算结果只影响缩放边界，不影响布局）。
 */
const fitted = computed(() => {
  const nw = natural.value.width || 1
  const nh = natural.value.height || 1
  const sw = stage.value.width || 1
  const sh = stage.value.height || 1
  const ratio = Math.min(sw / nw, sh / nh, 1)
  return { width: nw * ratio, height: nh * ratio, ratio }
})

/**
 * 允许的最大倍率。
 *
 * 不写死一个数字：原图若是 1672px、适应窗口只有 672px，那么 `fit` 到
 * 实际像素已经是 2.49×，再乘 2 才够用。取
 * `max(HARD_MAX_SCALE 的下限, 实际像素倍率 × 2)`，保证「1:1 一定到得了」。
 */
const maxScale = computed(() => {
  const actual = fitted.value.ratio > 0 ? 1 / fitted.value.ratio : 1
  return Math.min(64, Math.max(DOUBLE_TAP_SCALE, actual * 2, Math.min(HARD_MAX_SCALE, actual * 2)))
})

/** 是否值得提供「实际大小」入口：原图比适应窗口明显更大时才有意义。 */
const canActualSize = computed(() => fitted.value.ratio > 0 && 1 / fitted.value.ratio > 1.02)

/* ------------------------------------------------------------------ *
 * 平移边界
 * ------------------------------------------------------------------ */

/**
 * 把平移量夹在合法范围内。
 *
 * 硬停、不回弹：
 * - 回弹需要弹簧动画，而弹簧会被连续的拖拽打断成抖动；
 * - 越界继续拖还容易误触发翻页（代价不对等：误翻页比拖不动糟得多）。
 *
 * 可平移量 = (缩放后尺寸 − 舞台尺寸) / 2，两侧各一半。
 */
function clampTranslate(next: { x: number; y: number }): { x: number; y: number } {
  if (scale.value <= 1) return { x: 0, y: 0 }

  const shownWidth = fitted.value.width * scale.value
  const shownHeight = fitted.value.height * scale.value
  const maxX = Math.max(0, (shownWidth - stage.value.width) / 2)
  const maxY = Math.max(0, (shownHeight - stage.value.height) / 2)

  return {
    x: Math.min(maxX, Math.max(-maxX, next.x)),
    y: Math.min(maxY, Math.max(-maxY, next.y)),
  }
}

/* ------------------------------------------------------------------ *
 * 动作
 * ------------------------------------------------------------------ */

/** 从 DOM 收集当前页面的画廊。 */
function collectGallery(): LightboxItem[] {
  if (typeof document === 'undefined') return []

  const anchors = document.querySelectorAll<HTMLAnchorElement>('.prose a[data-lightbox]')
  const seen = new Set<string>()
  const list: LightboxItem[] = []

  for (const anchor of anchors) {
    const img = anchor.querySelector<HTMLImageElement>('img')
    const key = anchor.dataset.mediaKey ?? ''
    // 同一张图在正文里出现两次（比如两种语言混排的示例）只算一张
    if (key && seen.has(key)) continue
    if (key) seen.add(key)

    list.push({
      src: anchor.getAttribute('href') ?? '',
      thumb: img?.getAttribute('src') ?? anchor.getAttribute('href') ?? '',
      alt: img?.getAttribute('alt') ?? '',
      name: anchor.dataset.originName ?? '',
      key,
      trigger: anchor,
    })
  }

  return list
}

/**
 * 打开查看器。
 *
 * @param trigger 被点击的 `<a data-lightbox>`；不传则从 `activeElement` 推断
 *               （键盘回车触发时 `activeElement` 就是它）。关闭后焦点还给它。
 */
export function openLightbox(trigger?: HTMLElement | null): void {
  const gallery = collectGallery()
  if (gallery.length === 0) return

  const element = trigger ?? (document.activeElement as HTMLElement | null)
  const position = element ? gallery.findIndex((item) => item.trigger === element) : 0

  items.value = gallery
  index.value = Math.max(0, position)
  scale.value = 1
  translate.value = { x: 0, y: 0 }
  natural.value = { width: 0, height: 0 }
  failed.value = false
  loading.value = true
  hintVisible.value = true
  open.value = true
}

/** 关闭并释放状态。 */
export function closeLightbox(): void {
  open.value = false
  // 焦点交还由组件负责（它拿得到 trigger，且知道 DOM 何时还在）
}

/** 翻页。端点不循环：`disable` 语义比"绕回第一张"更符合导航直觉。 */
export function goTo(next: number): void {
  if (next < 0 || next >= items.value.length || next === index.value) return

  index.value = next
  // 翻页一律复位到 fit：否则第 8 张会"看起来糊"（沿用上一张的 3× 缩放）
  scale.value = 1
  translate.value = { x: 0, y: 0 }
  natural.value = { width: 0, height: 0 }
  failed.value = false
  loading.value = true
}

export function goNext(): void {
  goTo(index.value + 1)
}

export function goPrevious(): void {
  goTo(index.value - 1)
}

/** 缩放到指定倍率（会被 `maxScale` 夹住）。 */
export function setScale(next: number): void {
  const clamped = Math.min(maxScale.value, Math.max(1, next))
  scale.value = clamped
  translate.value = clampTranslate(translate.value)
}

/** 以某个屏幕坐标为中心缩放。不传则以舞台中心为锚点。 */
export function zoomBy(factor: number, anchor?: { x: number; y: number }): void {
  const before = scale.value
  setScale(before * factor)
  const after = scale.value
  if (!anchor || after === before) return

  /*
   * 锚点缩放的推导：让锚点下方的图像点保持不动。
   * 屏幕上某点相对舞台中心的偏移 d，在缩放 s 下对应图像坐标 d / s。
   * 要让缩放后它仍在原屏幕位置，需要新增平移 (d / s0 - d / s1)… 化简后是：
   *   t1 = t0 + d · (1 − s0 / s1)
   */
  const ratio = 1 - before / after
  translate.value = clampTranslate({
    x: translate.value.x + anchor.x * ratio,
    y: translate.value.y + anchor.y * ratio,
  })
}

/** 双击：fit ↔ 2×。已经在 2× 以上则回到 fit。 */
export function toggleZoom(anchor?: { x: number; y: number }): void {
  if (scale.value > 1.01) {
    setScale(1)
    translate.value = { x: 0, y: 0 }
    return
  }
  zoomBy(DOUBLE_TAP_SCALE, anchor)
}

/** 实际像素（1:1）。 */
export function actualSize(): void {
  setScale(1 / (fitted.value.ratio || 1))
  translate.value = { x: 0, y: 0 }
}

/** 适应窗口。 */
export function fitToWindow(): void {
  setScale(1)
  translate.value = { x: 0, y: 0 }
}

/** 拖动平移（仅 `scale > 1`）。 */
export function panBy(dx: number, dy: number): void {
  if (scale.value <= 1) return
  translate.value = clampTranslate({
    x: translate.value.x + dx,
    y: translate.value.y + dy,
  })
}

/** 滚轮缩放。 */
export function zoomByWheel(delta: number, anchor?: { x: number; y: number }): void {
  // deltaMode 1 = 按行滚动（Firefox 常见），换算成近似像素
  const factor = Math.exp(-delta * WHEEL_K)
  zoomBy(Math.min(1.25, Math.max(0.8, factor)), anchor)
}

/* ------------------------------------------------------------------ *
 * 只读导出给组件
 * ------------------------------------------------------------------ */

export function useImageViewer() {
  return {
    // 状态
    isOpen: readonly(open),
    items: readonly(items),
    index: readonly(index),
    current,
    scale: readonly(scale),
    translate: readonly(translate),
    natural,
    stage,
    loading,
    failed,
    gesturing,
    hintVisible,
    // 派生
    fitted,
    maxScale,
    canActualSize,
    total: computed(() => items.value.length),
    // 动作
    open: openLightbox,
    close: closeLightbox,
    next: goNext,
    previous: goPrevious,
    goTo,
    setScale,
    zoomBy,
    toggleZoom,
    actualSize,
    fitToWindow,
    panBy,
    zoomByWheel,
    clampTranslate,
    STEP_RATIO,
    DOUBLE_TAP_SCALE,
  }
}

/** 供单测：重置到初始状态。 */
export function resetLightboxState(): void {
  open.value = false
  items.value = []
  index.value = 0
  scale.value = 1
  translate.value = { x: 0, y: 0 }
  natural.value = { width: 0, height: 0 }
  stage.value = { width: 0, height: 0 }
  loading.value = false
  failed.value = false
  gesturing.value = false
  hintVisible.value = true
}
