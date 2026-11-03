/**
 * 设备形态判定的唯一来源。
 *
 * 本站是「一套内核 + 两套外壳」：PC 与移动端共用组件、数据与内容管线，
 * 差异只体现在外壳（页头 / 导航 / 胶囊 / 浮层形态）与样式层。
 * 需要**在运行时**做设备判定的地方极少（目前只有搜索面板算展开原点），
 * 所以这里只提供两样东西：条件字符串 + 一次匹配。
 *
 * CSS 不能 import TS：`styles/` 下多处手抄同一条件，改这里必须同步改它们
 * （构建时由 `support/mobile-breakpoints.ts` 校验，不一致会直接构建失败）。
 *
 * 为什么条件是 `(max-width: 720px), (pointer: coarse) and (max-height: 500px)`
 * 而不是单看宽度：横屏手机宽度可达 932px，只看宽度会退回桌面外壳。
 * 完整推导见 `styles/mobile.css` 顶部注释。
 */

/** 移动端外壳的媒体查询条件（CSS 侧的构造期校验以它为准）。 */
export const MOBILE_MEDIA = '(max-width: 720px), (pointer: coarse) and (max-height: 500px)'

/**
 * 当前视口是否使用移动端外壳。
 *
 * SSR 期间与不支持 `matchMedia` 的环境恒为 false —— 外壳切换是 CSS 的职责，
 * 这里只用于「必须在 JS 里知道当前形态」的少数几何计算。
 */
export function matchesMobile(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(MOBILE_MEDIA).matches
}
