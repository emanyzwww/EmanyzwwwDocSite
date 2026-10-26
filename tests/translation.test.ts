import { describe, expect, it } from 'vitest'

import {
  buildTranslationIndex,
  translatedUrl,
  translationKeyOf,
} from '../.vitepress/support/translation'
import type { PostSummary } from '../.vitepress/types'

/** 文章跨语言配对：配对键推导与按键索引（修复中文 slug 下语言切换失配的回归锁）。 */

describe('translationKeyOf', () => {
  it('从 posts 目录的日期+编号段推导配对键', () => {
    expect(translationKeyOf({}, 'zh-cn/posts/2026/10/19/01/你好，世界/index.md')).toBe(
      'posts/2026/10/19/01',
    )
    expect(translationKeyOf({}, 'en/posts/2026/10/19/01/hello-world/index.md')).toBe(
      'posts/2026/10/19/01',
    )
  })

  it('同一篇文章的各语言版本推导出相同的键', () => {
    const zh = translationKeyOf({}, 'zh-cn/posts/2026/10/19/01/你好，世界/index.md')
    const en = translationKeyOf({}, 'en/posts/2026/10/19/01/hello-world/index.md')
    expect(zh).toBe(en)
  })

  it('frontmatter 显式声明优先于路径推导', () => {
    expect(
      translationKeyOf({ translationKey: 'my-post' }, 'zh-cn/posts/2026/10/19/01/x/index.md'),
    ).toBe('my-post')
  })

  it('显式声明容忍首尾空白，空串视同未声明', () => {
    expect(
      translationKeyOf({ translationKey: '  my-post  ' }, 'en/posts/2026/01/01/01/x/index.md'),
    ).toBe('my-post')
    expect(translationKeyOf({ translationKey: '   ' }, 'en/posts/2026/01/01/01/x/index.md')).toBe(
      'posts/2026/01/01/01',
    )
  })

  it('非 posts/日期/编号 结构没有稳定键', () => {
    expect(translationKeyOf({}, 'zh-cn/about/index.md')).toBeNull()
    expect(translationKeyOf({}, 'en/posts/index.md')).toBeNull()
    // 编号段缺失或格式不符都不猜
    expect(translationKeyOf({}, 'en/posts/2026/10/19/hello-world/index.md')).toBeNull()
    expect(translationKeyOf({}, 'en/posts/2026/hello-world/index.md')).toBeNull()
  })

  it('路径推导不认错语言前缀', () => {
    // 没有语言前缀的路径不推导（内容约定语言必须是第一段）
    expect(translationKeyOf({}, 'posts/2026/10/19/01/hello-world/index.md')).toBeNull()
  })
})

/** PostSummary 测试替身：只填索引构建用得到的字段。 */
function post(url: string, locale: 'zh-cn' | 'en', translationKey: string | null): PostSummary {
  return {
    url,
    title: url,
    summary: '',
    date: '2026-10-19T04:09:28.000Z',
    isoDate: '2026-10-19',
    dateText: '',
    dateShort: '',
    year: '2026',
    tags: [],
    wordCount: 0,
    draft: false,
    locale,
    filePath: `${locale}/posts/2026/10/19/01/index.md`,
    translationKey,
  }
}

describe('buildTranslationIndex / translatedUrl', () => {
  const index = buildTranslationIndex([
    post(
      '/zh-cn/posts/2026/10/19/01/%E4%BD%A0%E5%A5%BD%EF%BC%8C%E4%B8%96%E7%95%8C/',
      'zh-cn',
      'posts/2026/10/19/01',
    ),
    post('/en/posts/2026/10/19/01/hello-world/', 'en', 'posts/2026/10/19/01'),
    post('/zh-cn/posts/2026/11/01/02/only-zh/', 'zh-cn', 'posts/2026/11/01/02'),
  ])

  it('按键取到目标语言的真实地址（slug 不同也能配上）', () => {
    expect(translatedUrl(index, 'posts/2026/10/19/01', 'en')).toBe(
      '/en/posts/2026/10/19/01/hello-world/',
    )
    expect(translatedUrl(index, 'posts/2026/10/19/01', 'zh-cn')).toBe(
      '/zh-cn/posts/2026/10/19/01/%E4%BD%A0%E5%A5%BD%EF%BC%8C%E4%B8%96%E7%95%8C/',
    )
  })

  it('目标语言没有翻译时返回 null（由调用方走三级回退）', () => {
    expect(translatedUrl(index, 'posts/2026/11/01/02', 'en')).toBeNull()
  })

  it('未知键或空键返回 null', () => {
    expect(translatedUrl(index, 'posts/9999/01/01/01', 'en')).toBeNull()
    expect(translatedUrl(index, null, 'en')).toBeNull()
  })

  it('没有配对键的文章不进索引', () => {
    const empty = buildTranslationIndex([post('/zh-cn/about/', 'zh-cn', null)])
    expect(empty.size).toBe(0)
  })
})
