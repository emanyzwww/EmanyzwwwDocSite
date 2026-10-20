/**
 * 主题入口。
 *
 * 只做三件事：
 * 1. 注册主题样式（入口文件负责按顺序串起各分层样式）；
 * 2. 给代码块复制按钮补上本地化文案（VitePress 已接管点击行为，
 *    但按钮的 `title` 与「已复制」提示来自配置，无法逐页区分语言）；
 * 3. 路由切换后重新标记，保证客户端跳转的页面文案也正确。
 *
 * 其余逻辑都在组件与组合式函数里，这里不做业务处理。
 */

import { onContentUpdated } from 'vitepress'
import type { Theme } from 'vitepress'

import type { Messages } from '../types'
import { MESSAGES } from './i18n'
import Layout from './Layout.vue'

import './styles/index.css'

/** 由路径判断当前语言的文案表。 */
function messagesOf(path: string): Messages {
  return path.startsWith('/en/') || path === '/en' ? MESSAGES.en : MESSAGES.root
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

export default {
  Layout,
  enhanceApp() {
    if (typeof window === 'undefined') return

    onContentUpdated(localizeCopyButtons)
    // 首屏内容在挂载后才渲染完成，等一帧再标记
    window.requestAnimationFrame(localizeCopyButtons)
  },
} satisfies Theme
