/**
 * 自绘滚动条的几何计算。
 *
 * 这里**只做数学，不碰 DOM**，所以可以直接在 node 下单测
 * （与 `support/pagination.ts` 同一类：纯函数、可测、无框架依赖）。
 *
 * ---------- 三个坐标 ----------
 *
 * 全部用「视口坐标」，单位 px：
 *
 * ```text
 *   0 ─────────────────────────── 视口顶
 *   │  页头（--header-height）
 *   ├─ trackTop ────────────────  轨道上沿 = 页头下沿
 *   │      ▲ offset
 *   │   ┌──┴──────┐
 *   │   │ 拇指    │ length
 *   │   └─────────┘
 *   ├─ trackBottom ─────────────  视口底
 * ```
 *
 * `trackTop` 由调用方测量页头下沿得到（见 `composables/useScrollBar.ts`），
 * 不是写死 `--header-height` —— 那个变量是「布局契约」，历史上与实际页头
 * 高度漂移过一次（见 DEVELOPING.md 的进度条一节），测量比相信契约可靠。
 */

/** 一次测量得到的页面与轨道尺寸。 */
export interface ScrollMetrics {
  /** 视口高度。 */
  viewport: number
  /** 文档总高度（`scrollHeight`）。 */
  content: number
  /** 轨道上沿在视口中的 y 坐标（= 页头下沿）。 */
  trackTop: number
  /** 轨道下沿在视口中的 y 坐标（= 视口底）。 */
  trackBottom: number
  /** 拇指最短长度。低于它拇指就退化成一条难以察觉的细缝。 */
  minThumb: number
}

/** 拇指的计算结果。 */
export interface ThumbBox {
  /** 拇指长度。 */
  length: number
  /** 拇指相对**轨道上沿**的偏移。 */
  offset: number
  /** 轨道长度。 */
  track: number
  /** 可滚动距离（`content - viewport`，不小于 0）。 */
  maxScroll: number
}

/** 把 `value` 夹进 `[min, max]`；非数值一律回落到 `min`。 */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), max)
}

/**
 * 计算拇指的长度与位置。
 *
 * **长度**按「视口 / 文档」的比例分配，但**下限是 `minThumb`**：
 * 一篇很长的文章按纯比例算出来可能只有十几像素，既看不见也拖不准。
 * 下限取页头高度，正好让拇指在短页与长页之间保持同一个视觉重量。
 *
 * **位置**按滚动进度线性映射到「轨道长度 − 拇指长度」这段可走距离上，
 * 也就是拇指的**上沿**从 `trackTop` 走到 `trackBottom - length` ——
 * 滚到底时拇指下沿恰好贴住视口底，不会留一截空白。
 */
export function computeThumb(metrics: ScrollMetrics, scrollTop: number): ThumbBox {
  const track = Math.max(0, metrics.trackBottom - metrics.trackTop)
  const maxScroll = Math.max(0, metrics.content - metrics.viewport)
  const empty: ThumbBox = { length: 0, offset: 0, track, maxScroll }

  // 轨道被压没（视口比页头还矮）或尺寸还没测出来
  if (track <= 0 || metrics.viewport <= 0 || metrics.content <= 0) return empty

  const natural = track * (metrics.viewport / metrics.content)
  /*
   * 上下限都要夹：
   * - 下沿 `minThumb` —— 短内容时比例会算出比轨道还长，上界兜住；
   * - 上沿 `track`    —— 内容不足一屏时拇指就是整条轨道（此分支下不可滚，
   *                      调用方会把它隐藏，但几何值仍必须合法）。
   */
  const length = clamp(natural, Math.min(metrics.minThumb, track), track)
  const travel = track - length
  const offset = maxScroll > 0 ? (clamp(scrollTop, 0, maxScroll) / maxScroll) * travel : 0

  return { length, offset, track, maxScroll }
}

/**
 * 把拇指偏移反算成 `scrollTop`（拖拽用）。
 *
 * 与 `computeThumb` 互为逆运算：对任意 `scrollTop`，
 * `scrollTopForOffset(computeThumb(m, y), computeThumb(m, y).offset) === y`。
 *
 * 可走距离为 0 时返回 0 —— 此时拇指占满整条轨道，没有可供表达的进度，
 * 调用方应当在开始拖拽前就跳过（见 `useScrollBar`）。
 */
export function scrollTopForOffset(box: ThumbBox, offset: number): number {
  const travel = box.track - box.length
  if (travel <= 0 || box.maxScroll <= 0) return 0
  return (clamp(offset, 0, travel) / travel) * box.maxScroll
}

/* ---------- 自动隐藏 ---------- */

/** 判断滚动条是否应当显示所需的输入。 */
export interface RevealInput {
  /** 距最后一次用户活动（滚动 / 指针进入）的毫秒数。 */
  idleFor: number
  /** 指针是否停在右侧的揭示带内。 */
  pointerInside: boolean
  /** 是否正在拖拽拇指。 */
  dragging: boolean
  /** 空闲多久之后隐藏。 */
  idleDelay: number
}

/**
 * 滚动条是否应当显示。
 *
 * 默认隐藏，只在三种情况下出现：
 *
 * 1. **正在滚动**（`idleFor < idleDelay`）——滚一下就能看到进度；
 * 2. **指针在右侧揭示带内**——想去拖它的时候它一定在；
 * 3. **正在拖拽**——拖到一半指针可能离开带子，此时必须保持可见。
 *
 * 为什么默认隐藏：页面只比视口高一点点时，拇指按比例会占掉轨道的 80% 以上
 * （例：1070px 文档 / 900px 视口 → 拇指 702px）。这样一根长条常驻在右侧，
 * 视觉重量远超它提供的信息量。原生 macOS 覆盖式滚动条也是同样的取舍。
 *
 * 非数值一律按"已空闲"处理 —— 宁可少显示，也不要因为 NaN 卡在常显。
 */
export function shouldReveal(input: RevealInput): boolean {
  if (input.dragging || input.pointerInside) return true
  if (!Number.isFinite(input.idleFor)) return false
  return input.idleFor < input.idleDelay
}
