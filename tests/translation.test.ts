import { describe, expect, it } from 'vitest'

import {
  buildTranslationIndex,
  translatedUrl,
  translationKeyOf,
} from '../.vitepress/support/translation'
import type { PostSummary } from '../.vitepress/types'

/** 文章跨语言配对：配对键推导与按键索引（修复中文 slug 下语言切换失配的回归锁）。 */

describe('translationKeyOf', () => {
  it('从年月/日序号目录推导配对键', () => {
    expect(translationKeyOf({}, 'zh-cn/202610/1901/index.md')).toBe('202610/1901')
    expect(translationKeyOf({}, 'en/202610/1901/index.md')).toBe('202610/1901')
  })

  it('同一篇文章的各语言版本推导出相同的键（slug 不参与）', () => {
    const zh = translationKeyOf({}, 'zh-cn/202610/1901/index.md')
    const en = translationKeyOf({}, 'en/202610/1901/index.md')
    expect(zh).toBe(en)
  })

  it('frontmatter 显式声明优先于路径推导', () => {
    expect(translationKeyOf({ translationKey: 'my-post' }, 'zh-cn/202610/1901/index.md')).toBe(
      'my-post',
    )
  })

  it('显式声明容忍首尾空白，空串视同未声明', () => {
    expect(translationKeyOf({ translationKey: '  my-post  ' }, 'en/202601/0101/index.md')).toBe(
      'my-post',
    )
    expect(translationKeyOf({ translationKey: '   ' }, 'en/202601/0101/index.md')).toBe(
      '202601/0101',
    )
  })

  it('非文章目录没有稳定键', () => {
    expect(translationKeyOf({}, 'zh-cn/pages/about/index.md')).toBeNull()
    expect(translationKeyOf({}, 'en/pages/posts/index.md')).toBeNull()
    expect(translationKeyOf({}, 'zh-cn/index.md')).toBeNull()
    // 只在「年月/日序号/index.md」这一种形态下才推导，其它层级都不猜
    expect(translationKeyOf({}, 'en/202610/1901/hello-world/index.md')).toBeNull()
    expect(translationKeyOf({}, 'en/2026/10/19/01/index.md')).toBeNull()
  })

  it('路径推导不认错语言前缀', () => {
    // 没有语言前缀的路径不推导（内容约定语言必须是第一段）
    expect(translationKeyOf({}, '202610/1901/index.md')).toBeNull()
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
    filePath: `${locale}/202610/1901/index.md`,
    translationKey,
  }
}

describe('buildTranslationIndex / translatedUrl', () => {
  const index = buildTranslationIndex([
    post(
      '/zh-cn/202610/1901/%E4%BD%A0%E5%A5%BD%EF%BC%8C%E4%B8%96%E7%95%8C/',
      'zh-cn',
      '202610/1901',
    ),
    post('/en/202610/1901/hello-world/', 'en', '202610/1901'),
    post('/zh-cn/202611/0102/only-zh/', 'zh-cn', '202611/0102'),
  ])

  it('按键取到目标语言的真实地址（slug 不同也能配上）', () => {
    expect(translatedUrl(index, '202610/1901', 'en')).toBe('/en/202610/1901/hello-world/')
    expect(translatedUrl(index, '202610/1901', 'zh-cn')).toBe(
      '/zh-cn/202610/1901/%E4%BD%A0%E5%A5%BD%EF%BC%8C%E4%B8%96%E7%95%8C/',
    )
  })

  it('目标语言没有翻译时返回 null（由调用方走回退）', () => {
    expect(translatedUrl(index, '202611/0102', 'en')).toBeNull()
  })

  it('未知键或空键返回 null', () => {
    expect(translatedUrl(index, '999912/0101', 'en')).toBeNull()
    expect(translatedUrl(index, null, 'en')).toBeNull()
  })

  it('没有配对键的文章不进索引', () => {
    const empty = buildTranslationIndex([post('/zh-cn/pages/about/', 'zh-cn', null)])
    expect(empty.size).toBe(0)
  })
})
