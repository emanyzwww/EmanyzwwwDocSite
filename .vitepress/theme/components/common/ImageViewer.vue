<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { useImageViewer } from '../../composables/useImageViewer'
import { usePresence } from '../../composables/usePresence'
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
  origin,
  clearOrigin,
  fitted,
} = useImageViewer()

/** 焦点陷阱的根：必须是舞台而不是整个对话框（见下方 `watch`）。 */
const frameEl = ref<HTMLElement | null>(null)
const stageEl = ref<HTMLElement | null>(null)
const closeEl = ref<HTMLButtonElement | null>(null)
const imageEl = ref<HTMLImageElement | null>(null)

/**
 * 进出状态机。
 *
 * 旧实现 `v-if="isOpen"`：关闭瞬间节点就没了，退出动画来不及开始
 * （实测关闭后同帧 `document.querySelector('.lightbox')` 即为 null）。
 * 现在 DOM 多留 `LIGHTBOX_EXIT_MS`（280ms），这段时间用来播"缩回原图位置"。
 */
/**
 * 进出状态机。
 *
 * 旧实现 `v-if="isOpen"`：关闭瞬间节点就没了，退出动画来不及开始
 * （实测关闭后同帧 `document.querySelector('.lightbox')` 即为 null）。
 * 现在 DOM 多留一段时间，用来播"缩回原图位置"。
 *
 * ⚠️ **时长必须 ≥ FLIP 的 260ms，不能沿用默认的 `EXIT_MS`（160ms）。**
 * 查看器退出时图片要缩回正文里那张缩略图的位置，这段 FLIP 比遮罩淡出长。
 * 若按默认 160ms 摘掉 DOM，FLIP 只播了六成、图片在半透明状态下突然消失 ——
 * 观感是"闪一下没了"，比不做还差。
 *
 * 取 280ms（FLIP 260 + 一帧余量）：遮罩的 160ms 淡出会先结束，
 * 于是收尾阶段只剩图片在飞回去，这正好是想要的主次关系。
 */
const FLIP_MS = 260
const LIGHTBOX_EXIT_MS = 280
const { present, exiting } = usePresence(isOpen, LIGHTBOX_EXIT_MS)

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

/**
 * 图片的显示尺寸。
 *
 * ---------- 为什么必须显式给 width/height ----------
 *
 * CSS 里是 `max-width: 100%; max-height: 100%; width: auto; height: auto`
 * —— 这套写法**只会缩小、不会放大**（`max-*` 的上限不构成尺寸）。
 * 而查看器是渐进加载的：先到位的是 672 档缩略图，原图随后替换。
 *
 * 于是出现一个实测到的复合 bug：
 *
 * | 时刻       | 加载的是 | `offsetWidth` | 后果 |
 * |------------|----------|---------------|------|
 * | 缩略图到位 | 672px    | 672           | FLIP 算 `672/672 = 1`，**缩放失效** |
 * | 原图到位   | 1672px   | 1440          | 布局尺寸跳变，图片"啪"地变大 |
 *
 * 两个症状同一个根因：**元素尺寸跟着"当前加载的那张图"走**。
 *
 * 修法是把尺寸钉在 `fitted`（由 `current.intrinsic` 算出的最终显示尺寸）上，
 * 从打开的第一帧就是终值 —— 与正在加载哪张图完全无关。
 *
 * 只在舞台已经量过（`stage.width > 0`）时才写内联尺寸：
 * 挂载的第一帧舞台还是 0，这时写了会把图片压成 0×0。
 */
const imageSize = computed<{ width?: string; height?: string }>(() => {
  if (!stage.value.width || !stage.value.height) return {}
  if (!fitted.value.width || !fitted.value.height) return {}
  return {
    width: `${fitted.value.width}px`,
    height: `${fitted.value.height}px`,
  }
})

/**
 * 当前图片的 `transform` 字符串（给 Web Animations 用作终态）。
 *
 * 动画的终态必须和元素**此刻的内联 transform 完全一致**，
 * 否则动画结束的瞬间会闪一下（Web Animations 结束后控制权交回内联样式）。
 */
function currentTransform(): string {
  return `translate3d(${translate.value.x}px, ${translate.value.y}px, 0) scale(${scale.value})`
}

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
    releaseTrap?.()
    releaseTrap = null
    document.removeEventListener('keydown', onGlobalKeydown, true)
    /*
     * 退出：图片缩回它在正文里的位置。
     *
     * 在 `isOpen` 变 false 的此刻播，而不是等 DOM 移除 ——
     * 因为 `usePresence` 会再留 `LIGHTBOX_EXIT_MS`（280ms），这段时间是给 FLIP
     * **和**遮罩淡出共用的时间轴。FLIP 是 260ms，遮罩是 160ms ——
     * 遮罩先结束，收尾只剩图片在飞回去。
     */
    playFlipOut()
    flipPlayed = false
    /*
     * 滚动锁与焦点归还**都推迟到退出动画结束**（见下方 `watch(present)`）。
     *
     * 若在这里立刻还焦点：`previousFocus.focus({preventScroll:true})` 会把焦点
     * 移到正文里那张图上，而遮罩还在屏幕上淡出 160ms —— 焦点已经跑到浮层外面，
     * 焦点陷阱也已解除，此刻按 Tab 会直接跳到被遮住的页面上。
     */
  }
})

/**
 * 退出动画结束、DOM 真正摘掉时才放锁、还焦点、清 FLIP 起点。
 *
 * 这是"进有动画、出是瞬断"那次改造的收尾：`v-if` 挂在 `present` 上，
 * 关闭后节点还会存在 `LIGHTBOX_EXIT_MS`（280ms）—— 那段时间里它仍在屏幕上，
 * 所以锁与焦点都必须继续"属于"它。
 */
watch(
  present,
  (isPresent) => {
    if (isPresent) return
    releaseScrollLock()
    previousFocus?.focus({ preventScroll: true })
    previousFocus = null
    /*
     * 节点即将被摘掉：先停掉 FLIP，否则动画对象还会持有一个已脱离文档的
     * 元素引用（Chromium 会在 `fill: forwards` 下继续合成这个元素）。
     */
    flipAnimation?.cancel()
    flipAnimation = null
    clearOrigin()
  },
  { flush: 'sync' },
)

/** 舞台尺寸变化（窗口缩放 / 横竖屏切换）后重算平移边界。 */
function measureStage(): void {
  const element = stageEl.value
  if (!element) return
  const rect = element.getBoundingClientRect()
  stage.value = { width: rect.width, height: rect.height }
}

/* ------------------------------------------------------------------ *
 * FLIP：图片从被点击的位置长出来 / 缩回去
 * ------------------------------------------------------------------ *
 *
 * ---------- 为什么用 Web Animations 而不是 CSS 类 + keyframes ----------
 *
 * FLIP 的起止值是**运行时测量**出来的（依赖点击位置、图片 fit 后尺寸、
 * 当前缩放倍率），没法写成静态 keyframes。CSS 自定义属性可以传值，
 * 但有两个问题：
 *
 * 1. 自定义属性在动画中不会逐帧插值（除非用 `@property` 声明类型，
 *    而声明之后又要在每个用到的地方维护类型）；
 * 2. 进入与退出的起点/终点不同，得写两套 keyframes + 一套变量，
 *    可读性反而更差。
 *
 * `element.animate()` 直接用真实数值插值，一次测量、一次调用，
 * 而且 `animation.finished` 是 promise —— 天然与 `usePresence` 的时序对齐。
 *
 * ---------- 为什么对 `transform` 做动画而不是改 width/height ----------
 *
 * 改尺寸会触发布局，整个舞台每帧重排；`transform` 只走合成层。
 * 代价是**缩放中的图片会有点糊**（被放大的位图），但那正是
 * "从缩略图放大"的视觉预期，不是缺陷。
 *
 * ---------- 退出为什么不用 `origin` ----------
 *
 * `origin` 是打开那一刻的 rect。读者可能已经在查看器里翻过页、缩放过 ——
 * 此时"缩回原位置"会缩到**打开时那一张**的位置，而不是当前这张在正文里的
 * 位置。所以退出时**重新测量**当前这张图在正文里的 rect（见 `triggerRect`）。
 */
/** 正在播放的 FLIP 动画（重复触发时先取消，避免两个动画抢同一个元素）。 */
let flipAnimation: Animation | null = null

/**
 * 当前这张图在正文里的屏幕矩形（退出用）。
 *
 * 找不到时返回 null（例如读者已经滚走、或图片被 CSS 隐藏）——
 * 那时退化成整体淡出，不做缩放。
 */
function triggerRect(): { x: number; y: number; width: number; height: number } | null {
  const img = current.value?.trigger?.querySelector('img')
  if (!img) return null
  const rect = img.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}

/**
 * 计算「fit 后图片」在屏幕上的矩形。
 *
 * 舞台是居中容器，图片按 `fitted` 的尺寸居中 —— 直接量 `<img>` 自己
 * 最准（它已经应用了 `max-width/max-height` 与当前 `transform` 之外的布局尺寸）。
 * 注意必须**排除当前 transform**：`getBoundingClientRect` 会包含它，
 * 所以这里用 `offsetWidth/offsetHeight`（布局尺寸，不含 transform，
 * 但取整到整数像素）配合舞台中心反推。
 */
function fittedRect(): { x: number; y: number; width: number; height: number } | null {
  const image = imageEl.value
  const element = stageEl.value
  if (!image || !element) return null

  const stageRect = element.getBoundingClientRect()
  // offsetWidth/Height 是布局尺寸（不受 transform 影响），但会四舍五入
  const width = image.offsetWidth
  const height = image.offsetHeight
  if (width <= 0 || height <= 0) return null

  return {
    x: stageRect.x + (stageRect.width - width) / 2,
    y: stageRect.y + (stageRect.height - height) / 2,
    width,
    height,
  }
}

/**
 * 由两个矩形算出 `translate + scale` 的起止关键帧。
 *
 * `transform-origin` 是元素中心，所以：
 *   scale     = from.width / to.width
 *   translate = from中心 − to中心
 *
 * 终止帧必须是元素**当前**的 transform（含平移与缩放），
 * 否则动画结束交回内联样式时会跳一下。
 */
function flipKeyframes(
  from: { x: number; y: number; width: number; height: number },
  to: { x: number; y: number; width: number; height: number },
): [Keyframe, Keyframe] {
  const ratio = from.width / to.width
  const dx = from.x + from.width / 2 - (to.x + to.width / 2)
  const dy = from.y + from.height / 2 - (to.y + to.height / 2)

  const start = `translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0) scale(${ratio.toFixed(4)})`
  const end = currentTransform()

  return [
    { transform: start, opacity: 0.6 },
    { transform: end, opacity: 1 },
  ]
}

/** 播放「从正文位置长出来」。进入时调用。 */
function playFlipIn(): void {
  const image = imageEl.value
  const from = origin.value
  if (!image || !from) return
  const to = fittedRect()
  if (!to) return

  flipAnimation?.cancel()
  flipAnimation = image.animate(flipKeyframes(from, to), {
    duration: FLIP_MS,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    fill: 'none',
  })
}

/** 播放「缩回正文位置」。退出时调用。 */
function playFlipOut(): void {
  const image = imageEl.value
  if (!image) return
  const to = triggerRect()
  if (!to) return
  const from = fittedRect()
  if (!from) return

  const [startFrame, endFrame] = flipKeyframes(to, from)
  flipAnimation?.cancel()
  flipAnimation = image.animate([startFrame, endFrame].toReversed(), {
    duration: FLIP_MS,
    easing: 'cubic-bezier(0.55, 0, 0.85, 0.36)',
    fill: 'forwards',
  })
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
  /*
   * FLIP 进入必须在**这里**播，不能挂在 `watch(present)` 上：
   * 那一刻 `<img>` 还没有尺寸（`offsetWidth === 0`），算不出终点。
   * 只有 load 之后平台才知道图片的真正显示尺寸。
   *
   * 只播一次：`origin` 在退出结束时才清空，但翻页 / 缩放不该重播动画。
   */
  if (present.value && origin.value && !flipPlayed) {
    flipPlayed = true
    playFlipIn()
  }
}

/** FLIP 进入是否已经播过（每打开一次只播一次）。 */
let flipPlayed = false

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
      v-if="present"
      class="lightbox"
      :class="{ 'is-exiting': exiting }"
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
              :style="{ ...imageTransform, ...imageSize }"
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
