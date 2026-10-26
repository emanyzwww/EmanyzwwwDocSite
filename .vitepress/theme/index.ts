/**
 * 主题入口。
 *
 * 只做五件事：
 * 1. 注册主题样式（入口文件负责按顺序串起各分层样式）；
 * 2. 装页面切换过渡（View Transitions，见 support/route-transition.ts）；
 * 3. 给代码块复制按钮补上本地化文案（VitePress 已接管点击行为，
 *    但按钮的 `title` 与「已复制」提示来自配置，无法逐页区分语言）；
 * 4. 路由切换后重新标记，保证客户端跳转的页面文案也正确；
 * 5. 构建期嵌入块（`:::github`）的运行期增强 —— 见 `embeds/enhance.ts`。
 *
 * 其余逻辑都在组件与组合式函数里，这里不做业务处理。
 */

import { onContentUpdated } from 'vitepress'
import type { Theme } from 'vitepress'

import type { Messages } from '../types'
import { EmbedEnhancer } from './embeds/enhance'
import { MESSAGES } from './i18n'
import Layout from './Layout.vue'
import { installAnchorScroll, markHeaderAnchorsRaw } from './support/anchor-scroll'
import { localeOfPath } from './support/paths'
import { installRouteTransition } from './support/route-transition'

import './styles/index.css'

/** 由路径判断当前语言的文案表。 */
function messagesOf(path: string): Messages {
  return MESSAGES[localeOfPath(path)]
}

/**
 * 给页面里的复制按钮打上本地化标签。
 *
 * - `title`：鼠标悬停提示
 * - `data-copied-label`：复制成功后按钮上显示的文字（样式在 content.css）
 */
function localizeCopyButtons(): void {
  const messages = messagesOf(location.pathname)

  document
    .querySelectorAll<HTMLButtonElement>('div[class*="language-"] > button.copy')
    .forEach((button) => {
      button.title = messages.copyCode
      button.dataset.copiedLabel = messages.copied
    })
}

/**
 * 给「已经加载完成」的图片打标记。
 *
 * 正文图片是构建期生成的静态 HTML（没有 Vue 组件），加载态只能靠
 * CSS + 一个布尔属性表达：`data-loaded` 在 → 骨架淡出、图片淡入
 * （样式见 content.css 的 prose-media 一节）。
 *
 * ## 为什么用捕获式委托而不是逐个绑 load
 *
 * `load` 事件**不冒泡**（普通委托收不到），但捕获阶段会经过 document ——
 * 所以在 document 上以捕获方式监听一次，就能覆盖全页所有 `<img>`，
 * 且天然覆盖客户端路由换页后的新 DOM，与 lightbox 的点击委托同一个模式。
 * 对已处于 complete 状态的图（缓存秒回、SSR 首屏）补扫一遍兜底。
 */
function markLoadedImages(): void {
  document.querySelectorAll<HTMLImageElement>('.prose img').forEach((img) => {
    if (img.complete && img.naturalWidth > 0) img.dataset.loaded = 'true'
  })
}

function onImageLoad(event: Event): void {
  const target = event.target
  if (target instanceof HTMLImageElement) target.dataset.loaded = 'true'
}

export default {
  Layout,
  enhanceApp({ router }) {
    if (typeof window === 'undefined') return

    /*
     * 图片加载完成标记（捕获式委托，见 markLoadedImages 的说明）。
     * 必须在 enhanceApp 装好 —— 它与路由无关，一份监听管全站。
     */
    document.addEventListener('load', onImageLoad, true)

    /*
     * 页面切换过渡挂在这里，而不是挂在某个组件里。
     *
     * 它改的是 `router.onBeforeRouteChange` / `onAfterRouteChange`，
     * 是**路由级**能力：必须早于任何一次导航装好（`enhanceApp` 在
     * `app.mount()` 之前执行，正好），而且必须只有一份。
     * 挂进 `PageShell` 会在每次组件重建时重复注册，后装的覆盖先装的。
     */
    installRouteTransition(router)
    /*
     * 目录/标题锚点的平滑滚动。
     *
     * 必须用捕获阶段抢在 VitePress 的 router 前面（它会硬跳），
     * 详见 support/anchor-scroll.ts 顶部那段推导。
     */
    /*
     * 目录/标题锚点的平滑滚动。
     *
     * 目录链接与 header-anchor 都打上了 `vp-raw`（VitePress 委托的豁免类），
     * 它们不会进入 VitePress 的点击处理 —— 滚动由 anchor-scroll 独家执行，
     * 避免"VitePress 先滚一次、锁释放后还原、我们再平滑滚一次"的抽搐。
     * 详见 support/anchor-scroll.ts 顶部那段推导。
     */
    installAnchorScroll()

    /*
     * 构建期嵌入块（`:::github`）的运行期增强。
     *
     * 与上面几个挂载点同样的理由：它要对**每一页**的正文章节生效，且必须
     * 只有一份实例（内部持有 IntersectionObserver 与请求去重表）。
     * 挂进某个页面组件会在每次路由切换时重建，缓存与观察器全部重来。
     *
     * 文案按当前路径取：`enhanceApp` 执行时页面尚未渲染，所以传的是
     * **取值函数**而不是值——真正用到时（异步请求回来）再读。
     */
    const enhancer = new EmbedEnhancer(() => messagesOf(location.pathname))

    onContentUpdated(() => {
      localizeCopyButtons()
      markLoadedImages()
      // 每次内容更新后，给新生成的标题锚补打豁免类
      markHeaderAnchorsRaw()
      // 路由切换后正文是新节点，必须重新扫一遍
      enhancer.scan(document)
    })
    // 首屏内容在挂载后才渲染完成，等一帧再标记
    window.requestAnimationFrame(() => {
      localizeCopyButtons()
      markLoadedImages()
      markHeaderAnchorsRaw()
      enhancer.scan(document)
    })
  },
} satisfies Theme
