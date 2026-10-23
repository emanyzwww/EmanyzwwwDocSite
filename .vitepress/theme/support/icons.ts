/**
 * 图标表。
 *
 * 每个图标只描述「画法」，尺寸与颜色统一交给 CSS（`.icon` + `currentColor`）。
 * 这样新增图标只需要在这里加一条，不必再碰任何模板。
 *
 * - `stroke`：线性图标，用 `stroke` 描边，`fill` 为 none
 * - `fill`：填充图标（品牌 logo、汉字字形），用 `fill` 上色
 */

import type { IconName } from '../../types'

export interface IconDef {
  /** 视口尺寸。绝大多数为 24×24。 */
  viewBox: string
  /** 绘制方式。 */
  mode: 'stroke' | 'fill'
  /** SVG 子元素（路径 / 圆 / 矩形）。 */
  body: string
  /** 描边宽度，仅 `stroke` 模式使用。 */
  strokeWidth?: number
}

/** 线性图标默认描边宽度。 */
const STROKE_WIDTH = 1.8

export const ICONS: Record<IconName, IconDef> = {
  sun: {
    viewBox: '0 0 24 24',
    mode: 'stroke',
    body: `<circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />`,
  },
  moon: {
    viewBox: '0 0 24 24',
    mode: 'stroke',
    body: `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />`,
  },
  globe: {
    viewBox: '0 0 24 24',
    mode: 'stroke',
    body: `<circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />`,
  },
  // 「中」字形：填充式路径。viewBox 按字形包围盒等比外扩留白，
  // 使视觉高度与同为 1.1rem 的描边图标（如英文 A）相当。
  zh: {
    viewBox: '152 93 740 849',
    mode: 'fill',
    body: `<path d="M555.231787 330.203429v-107.997284h-68.202727v108.038827H263.433935v273.457531H487.02906v210.976899h68.202727V603.70431h224.21827V330.203429H555.231787z m-68.202727 209.074952h-157.337694v-144.605675h157.335888v144.605675z m226.131053 0H555.195662v-144.605675h157.962645v144.605675z" />`,
  },
  en: {
    viewBox: '0 0 24 24',
    mode: 'stroke',
    body: `<path d="M4.5 20 12 4.5 19.5 20" /><path d="M7.75 14.5h8.5" />`,
  },
  'chevron-down': {
    viewBox: '0 0 24 24',
    mode: 'stroke',
    strokeWidth: 2,
    body: `<path d="m6 9 6 6 6-6" />`,
  },
  'arrow-right': {
    viewBox: '0 0 24 24',
    mode: 'stroke',
    body: `<path d="M5 12h14M12 5l7 7-7 7" />`,
  },
  'arrow-left': {
    viewBox: '0 0 24 24',
    mode: 'stroke',
    body: `<path d="M19 12H5M12 19l-7-7 7-7" />`,
  },
  calendar: {
    viewBox: '0 0 24 24',
    mode: 'stroke',
    body: `<rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />`,
  },
  clock: {
    viewBox: '0 0 24 24',
    mode: 'stroke',
    body: `<circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />`,
  },
  tag: {
    viewBox: '0 0 24 24',
    mode: 'stroke',
    body: `<path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><circle cx="7" cy="7" r="1.2" />`,
  },
  list: {
    viewBox: '0 0 24 24',
    mode: 'stroke',
    body: `<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />`,
  },
  rss: {
    viewBox: '0 0 24 24',
    mode: 'stroke',
    body: `<path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16" /><circle cx="5" cy="19" r="1.5" fill="currentColor" stroke="none" />`,
  },
  github: {
    viewBox: '0 0 24 24',
    mode: 'fill',
    body: `<path d="M12 .5C5.73.5.5 5.73.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.55v-1.94c-3.2.7-3.88-1.54-3.88-1.54-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.12 3.05.74.81 1.18 1.84 1.18 3.1 0 4.43-2.69 5.4-5.26 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.66.8.55A11.5 11.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5z" />`,
  },
  mail: {
    viewBox: '0 0 24 24',
    mode: 'stroke',
    body: `<rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 6L2 7" />`,
  },
  twitter: {
    viewBox: '0 0 24 24',
    mode: 'fill',
    body: `<path d="M18.9 2H22l-7.1 8.1L23.2 22h-6.5l-5.1-6.7L5.8 22H2.7l7.6-8.7L1.2 2h6.7l4.6 6.1L18.9 2zm-1.1 18h1.7L7.3 3.8H5.5L17.8 20z" />`,
  },
  link: {
    viewBox: '0 0 24 24',
    mode: 'stroke',
    body: `<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />`,
  },
  // ---------- 移动端专用（抽屉导航 / 底部操作栏） ----------
  menu: {
    viewBox: '0 0 24 24',
    mode: 'stroke',
    strokeWidth: 2,
    body: `<path d="M4 6h16M4 12h16M4 18h16" />`,
  },
  close: {
    viewBox: '0 0 24 24',
    mode: 'stroke',
    strokeWidth: 2,
    body: `<path d="M18 6 6 18M6 6l12 12" />`,
  },
  search: {
    viewBox: '0 0 24 24',
    mode: 'stroke',
    body: `<circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />`,
  },
  home: {
    viewBox: '0 0 24 24',
    mode: 'stroke',
    body: `<path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h5v-6h4v6h5V9.5" />`,
  },
  toc: {
    viewBox: '0 0 24 24',
    mode: 'stroke',
    body: `<path d="M4 6h10M4 12h10M4 18h6" /><path d="M18 8v8" /><path d="m15.5 13.5 2.5 2.5 2.5-2.5" />`,
  },
  'arrow-up': {
    viewBox: '0 0 24 24',
    mode: 'stroke',
    body: `<path d="M12 19V5M5 12l7-7 7 7" />`,
  },
}

/** 取图标定义；名字非法时回退到 `link`，避免整页渲染失败。 */
export function getIcon(name: IconName | undefined): IconDef {
  return (name && ICONS[name]) || ICONS.link
}

export { STROKE_WIDTH }
