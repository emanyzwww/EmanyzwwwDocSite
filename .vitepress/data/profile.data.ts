/**
 * 个人资料（数据加载器）。
 *
 * `bio` 在这里就渲染成 HTML，客户端只负责显示；**每种语言各渲染一份**，
 * 因为布局无法在构建期知道当前页面语言（数据加载器不接收页面上下文），
 * 而 Markdown 渲染只能在构建期做。
 */

import { defineLoader } from 'vitepress'

import { renderMarkdown } from '../support/markdown'
import type { LocaleCode, RenderedProfile } from '../types'
import { PROFILE } from './profile'

export type Data = RenderedProfile

declare const data: Data
export { data }

/** 语言 → 该语言的原始文案（缺省回退到默认语言）。 */
function copyOf(locale: LocaleCode): { tagline: string; bio: string } {
  const fallback = { tagline: PROFILE.tagline, bio: PROFILE.bio }
  return { ...fallback, ...PROFILE.i18n?.[locale] }
}

export default defineLoader({
  load(): Data {
    const { bio: _bio, i18n: _i18n, ...rest } = PROFILE
    const zh = copyOf('zh-cn')
    const en = copyOf('en')

    return {
      ...rest,
      // 默认语言的 HTML 单独留一份：不关心语言的调用方直接用，语义最清楚
      bioHtml: renderMarkdown(zh.bio),
      i18n: {
        'zh-cn': { tagline: zh.tagline, bioHtml: renderMarkdown(zh.bio) },
        en: { tagline: en.tagline, bioHtml: renderMarkdown(en.bio) },
      },
    }
  },
})
