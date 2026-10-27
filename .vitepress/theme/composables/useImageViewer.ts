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
  /**
   * LQIP 占位图（`data:` URI，来自正文 `<img data-lqip>`）。
   *
   * 查看器加载的是**按舞台像素挑选的档位**（见 `variants`），那张图通常
   * 还没被正文请求过（正文按 672 档显示）。等它到位的这段时间里，
   * LQIP 先给舞台铺上这张图的色彩，避免"黑屏等图"。
   * 没有则为空串。
   */
  lqip: string
  /**
   * 可用于舞台的图片档位（从正文 `<img srcset>` 解析，按宽度升序）。
   *
   * ---------- 为什么不能只用 `thumb` ----------
   *
   * `thumb` 是正文那张 **672 档**。实测桌面舞台宽 1365px，把 672 的图
   * 铺到 1365px 上是**放大 2 倍插值**——读者看到的就是"糊图"，
   * 要等原图（实测 5.4 MB 的 PNG）下载完才清晰。这正是需求里
   * "显示的图片会很糊，过一会清晰的图片才拉到"的根因。
   *
   * 所以查看着按**舞台实际需要的像素**在档位里挑：fit 用就近的大档
   * （2016 档约 190 KB），放大到超过最大档时才落到原图。
   *
   * 空数组 = 这张图没有多档（矢量 / 单档 / public 资源），直接用 `src`。
   */
  variants: { url: string; width: number }[]
  /** 触发元素，关闭后焦点要还给它。 */
  trigger: HTMLElement | null
  /**
   * **原图**的固有尺寸（来自正文 `<img>` 的 `width`/`height` 属性）。
   *
   * 这两个值由构建期的图片管线写入（`media/render.ts` 用 `probe` 读到的
   * 真实像素），因此**打开查看器之前就知道**，不必等原图加载。
   *
   * 为什么必须提前知道，而不是等 `load` 事件：
   * 查看器是渐进加载的（先放 672 缩略图、再换原图）。若 `fitted` 依赖
   * `natural`（来自当前加载的那张），那么缩略图到位时 `natural = 672×379`、
   * 原图到位后变成 `1672×941` —— 元素的布局尺寸会**跳一次**
   * （实测 672px → 1440px）。
   *
   * 这个跳变有两个后果，都是实测到的：
   * 1. 图片在读者眼前突然变大，像闪了一下；
   * 2. FLIP 的缩放比算成 `672 / 672 = 1`，**动画等于没做**（缩放失效）。
   *
   * 所以尺寸以「原图的固有尺寸」为准，从打开那一刻就是最终值。
   */
  intrinsic: { width: number; height: number }
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

/**
 * 打开时被点击图片在屏幕上的位置（FLIP 起点）。
 *
 * ---------- 为什么需要它 ----------
 *
 * 改造前点图 → 整屏瞬间变黑、图出现在正中，读者**失去了"我点的是哪张"的
 * 空间连续性**。这是查看器最缺的一环：画面跳变，而不是"这张图被放大了"。
 *
 * 记录点击时那张 `<img>` 的 rect，查看器就能让图片从那个位置/尺寸
 * 插值到居中的 fit 位置 —— 与 iOS 相册、macOS 预览的行为一致。
 *
 * 在 `openLightbox()` 里抓，**必须在开屏之前**：开屏后遮罩会盖住，
 * 而且 `getBoundingClientRect` 拿到的是被遮罩后（不变，但早了更准，
 * 也避免依赖"图片还在原位"）。
 */
const origin = ref<{ x: number; y: number; width: number; height: number } | null>(null)

const current = computed(() => items.value[index.value] ?? null)

/**
 * 当前设备的像素密度（1 = 普通屏，2/3 = 高分屏）。
 *
 * 挑档位必须乘上它：CSS 里 1365px 宽的舞台在 2× 屏上要 2730 个物理像素，
 * 只按 CSS 宽挑档会得到一张被放大两倍的糊图。
 * `devicePixelRatio` 可能不是整数（125% 缩放的 Windows 上是 1.25），
 * 这里取不小于它的整数，宁可多要一点像素也不要糊。
 */
function devicePixelRatioOf(): number {
  if (typeof window === 'undefined') return 1
  return Math.max(1, Math.ceil(window.devicePixelRatio || 1))
}

/**
 * 舞台内"适应窗口"时图片的显示尺寸。
 *
 * `natural` 在图片 `load` 之后才有值；在那之前按 1×1 兜底，
 * 避免除零（计算结果只影响缩放边界，不影响布局）。
 */
/**
 * 「适应窗口」时的显示尺寸。
 *
 * 用 `current.intrinsic`（构建期写入的原图尺寸）而不是 `natural`
 * （当前实际加载的那张图的尺寸）—— 后者在渐进加载过程中会从
 * 672 变成 1672，导致布局尺寸跳一次、FLIP 缩放退化成 1。详见
 * `LightboxItem.intrinsic` 的注释。
 *
 * `natural` 只作为兜底：万一某张图没有 `width`/`height` 属性
 * （例如手工写的 HTML），仍然能在 `load` 之后拿到正确比例。
 */
const fitted = computed(() => {
  const item = current.value
  const nw = item?.intrinsic.width || natural.value.width || 1
  const nh = item?.intrinsic.height || natural.value.height || 1
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

/**
 * 当前视野真正需要的图片宽度（物理像素）。
 *
 * = `fit 显示宽 × 当前缩放 × 设备像素密度`。
 * 在 fit 状态、1× 屏上是 `fitted.width`；放大到 2× 或换到 2× 屏就翻倍。
 *
 * 这个值决定「该请求哪一档」，是修掉"糊图"的关键：
 * 旧实现永远请求 672 档，桌面舞台 1365px 把它放大 2 倍插值，必然糊。
 *
 * ---------- 舞台还没量到时为什么退回视口宽 ----------
 *
 * `fitted` 依赖 `stage`，而 `stage` 要等组件挂载 + `measureStage()` 之后
 * 才有值。查看器"打开"那一刻（`watch` 的 immediate 分支）舞台还是
 * `{0, 0}`，`fitted` 于是退化成 1px —— 用这个值挑档会选中**最小的 336 档**，
 * 然后放大 4 倍铺满舞台（这正是实测到的"一打开就是糊图"）。
 *
 * 所以未测量时用视口宽兜底：它是舞台宽的上界，宁可挑大一档也不要挑小。
 * 舞台量到之后 `fitted` 变化会触发一次重新挑档（见 ImageViewer 的 watch），
 * 那条路径同时覆盖窗口缩放与横竖屏切换。
 */
const neededWidth = computed(() => {
  const dpr = devicePixelRatioOf()
  const measured = stage.value.width > 0
  const shown = measured
    ? fitted.value.width
    : typeof window === 'undefined'
      ? 0
      : window.innerWidth
  return Math.ceil(Math.max(shown, 1) * scale.value * dpr)
})

/**
 * 按需选档：满足 `neededWidth` 的最小档；都不够时退到最大档。
 *
 * ---------- 为什么不直接请求原图 ----------
 *
 * 原图实测可达 1.8–5.4 MB，打开就要白屏等。档位是构建期压好的 webp
 * （2016 档约 190 KB），到得早得多，而且在这个尺寸下**肉眼无差**
 * ——原图只在放大到超过最大档之后才有信息量。
 *
 * 返回空串表示这张图没有可用档位，调用方退到 `src`（原图 / 单档图）。
 */
const bestVariant = computed(() => {
  const list = current.value?.variants ?? []
  if (list.length === 0) return ''
  const need = neededWidth.value
  const hit = list.find((variant) => variant.width >= need)
  return (hit ?? list[list.length - 1]).url
})

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

/**
 * 解析可用的图片档位，按宽度升序。
 *
 * 三个来源合并：
 * 1. `<img srcset>` —— 构建期产出的展示档（336 / 672 / 1008 / 2016）；
 * 2. `<img src>` —— 正文当前显示的那张（`srcset` 缺失时是唯一来源）；
 * 3. `<a href>` 指向的**原图** —— 用固有宽度登记，作为最高一档。
 *
 * ---------- 为什么原图也要进候选 ----------
 *
 * 读者放大到超过最大 webp 档（2016）时，那一档已经没有更多信息量了，
 * 继续放大只是插值 —— 需求里"放大应当是完整原图"必须真的给原图。
 * 把原图按它的固有宽度排进候选，`bestVariant` 就会在需要时自然选中它，
 * 不需要写「放大超过 2× 就切原图」这种脆弱的倍率判断。
 *
 * 反过来，只要需求像素还在展示档覆盖范围内就永远不会选到原图 ——
 * 这正是"不为了 fit 状态去拉几 MB"的保证。
 */
function parseVariants(
  img: HTMLImageElement | null,
  src: string,
  originUrl: string,
  intrinsicWidth: number,
): { url: string; width: number }[] {
  const seen = new Map<string, number>()

  const add = (url: string, width: number): void => {
    const clean = url.trim()
    if (!clean) return
    const previous = seen.get(clean)
    // 同一地址登记两次时保留更大的宽度
    if (previous === undefined || width > previous) seen.set(clean, width)
  }

  const srcset = img?.getAttribute('srcset') ?? ''
  for (const part of srcset.split(',')) {
    const match = part.trim().match(/^(\S+?)\s+(\d+)w$/)
    if (match) add(match[1], Number(match[2]))
  }

  // 正文那张：没有 srcset 时它可能是唯一可用的地址，宽度未知按 0 兜底
  if (src && !seen.has(src)) add(src, 0)

  /*
   * 原图作为最高一档。
   *
   * 固有宽度未知时给 `Infinity`：保证它永远排在最后（兜底档），
   * 而不是因为 0 被排到最前、让 fit 状态直接去拉原图。
   */
  if (originUrl && originUrl !== src) {
    add(originUrl, intrinsicWidth > 0 ? intrinsicWidth : Number.POSITIVE_INFINITY)
  }

  return [...seen.entries()]
    .map(([url, width]) => ({ url, width }))
    .toSorted((a, b) => a.width - b.width)
}

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

    const thumb = img?.getAttribute('src') ?? anchor.getAttribute('href') ?? ''
    const originUrl = anchor.getAttribute('href') ?? ''

    /*
     * 原图固有尺寸：正文 `<img>` 上的 `width`/`height` 属性。
     *
     * 构建期的图片管线写的是**原图**尺寸（`media/render.ts` 用 probe
     * 读到的真实像素），不是 webp 档位尺寸 —— 所以这里拿到的就是
     * 查看器最终要展示的尺寸，与之后加载哪一张无关。
     *
     * 缺失时退回 0，由 `fitted` 再退到 `natural`。
     */
    const intrinsic = {
      width: Number(img?.getAttribute('width')) || 0,
      height: Number(img?.getAttribute('height')) || 0,
    }

    list.push({
      src: originUrl,
      thumb,
      alt: img?.getAttribute('alt') ?? '',
      name: anchor.dataset.originName ?? '',
      key,
      lqip: img?.dataset.lqip ?? '',
      trigger: anchor,
      variants: parseVariants(img, thumb, originUrl, intrinsic.width),
      intrinsic,
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
  const resolved = Math.max(0, position)

  /*
   * 抓 FLIP 起点：被点击那张 `<img>` 的屏幕位置。
   *
   * 用 `<img>` 而不是 `<a>`：链接是块级包裹（含 `::after` 缩放徽章），
   * 尺寸与图片一致，但图片在 `object-fit` 下可能比链接窄，
   * 取图片的 rect 才是"读者看到的那块像素"。
   */
  const picked = gallery[resolved]
  const img = picked?.trigger?.querySelector('img')
  if (img) {
    const rect = img.getBoundingClientRect()
    // 尺寸为 0 说明元素被隐藏（或还没布局完）：不做 FLIP，退回淡入
    origin.value =
      rect.width > 0 && rect.height > 0
        ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        : null
  } else {
    origin.value = null
  }

  items.value = gallery
  index.value = resolved
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
  /*
   * FLIP 起点**不能在这里清**：退出动画要用它把图片缩回原位。
   * 组件在退出动画结束后才清理（见 ImageViewer.vue 的 `watch(present)`）。
   */
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
    /** 当前视野需要的物理像素宽度（挑档依据）。 */
    neededWidth,
    /** 按需选中的档位地址；空串表示没有多档，调用方退到 `thumb` / `src`。 */
    bestVariant,
    total: computed(() => items.value.length),
    /** 打开时被点击图片的屏幕位置（FLIP 起点）；退出动画结束后由组件清空。 */
    origin,
    clearOrigin,
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

/** 供组件在退出动画结束后清理 FLIP 起点。 */
export function clearOrigin(): void {
  origin.value = null
}
