/**
 * 链接预览的「值不值得弹卡」判定。
 *
 * ## 为什么单独一个文件
 *
 * 这条判定**只跟读者的意图有关**，跟 DOM、Vue、网络都无关，却是历史上真出过
 * bug 的地方：图片链接（`<a data-lightbox>`，`href` 指向 `.png` 原图）被当成
 * 普通链接，悬浮时先亮骨架、再因为拿不到数据收起 —— 表现为「卡片一闪而过」。
 * 把它抽成纯函数，`PageShell` 只负责从 DOM 里**收集事实**，规则本身可以被单测
 * 直接钉住（`tests/link-preview-gate.test.ts`），不用起浏览器。
 *
 * ## 事实从哪来
 *
 * ```text
 * href         HTMLAnchorElement.href      // 浏览器解析后的绝对 URL
 * rawHref      getAttribute('href')        // 作者写的原样（识别 `#锚点`）
 * inProse      closest('.prose')           // 只在正文里弹卡
 * inEmbed      closest('.embed')           // 嵌入卡内部不弹（卡本身就是信息）
 * isLightbox   hasAttribute('data-lightbox') // 图片链接：悬浮反馈是放大角标
 * ```
 *
 * 这个模块**零依赖**：不 import vue / vitepress / DOM 类型，Node 里能直接跑。
 */

import { isPreviewableHref } from './core'

/** 一次悬浮命中的全部相关事实（由 `PageShell` 从 DOM 收集）。 */
export interface LinkTargetFacts {
  /** `HTMLAnchorElement.href`：浏览器解析后的绝对 URL；无 `href` 属性时是空串。 */
  href: string
  /** `getAttribute('href')`：作者写的原样，用来识别页内锚点。 */
  rawHref: string | null
  /** 链接在正文（`.prose`）里。 */
  inProse: boolean
  /** 链接在嵌入卡（`:::github` 等）里。 */
  inEmbed: boolean
  /** 链接是「点开看大图」的图片链接（`<a data-lightbox>`）。 */
  isLightbox: boolean
}

/**
 * 是否应该为这个链接弹预览卡。
 *
 * 五条排除，顺序按「便宜且互不重叠」排列，命中的理由都写在注释里：
 *
 * 1. 没有 `href` / 只有 `#锚点` —— 目标就在眼前，弹卡是噪声（页内跳转的
 *    标题锚点还会让每次划过都白排一次定时器）；
 * 2. 不是 http(s) —— `mailto:` / `tel:` / `javascript:` 没有 provider；
 * 3. 图片链接（`data-lightbox`）—— **这是本文件存在的直接原因**。它指向
 *    `.png` / `.webp` 原图，没有任何标题或摘要可预览；它的悬浮反馈是右下角
 *    「可放大」角标（`content.css`），再叠一张卡片只会闪一下；
 * 4. 嵌入卡内部 —— 卡片本身已经是完整信息，卡里的链接再弹卡是噪声；
 * 5. 不在正文里 —— 导航、侧栏、页脚的链接目标一目了然。
 */
export function shouldPreviewLink(facts: LinkTargetFacts): boolean {
  if (!facts.rawHref) return false
  if (facts.rawHref.startsWith('#')) return false
  if (!isPreviewableHref(facts.href)) return false
  if (facts.isLightbox) return false
  if (facts.inEmbed) return false
  return facts.inProse
}
