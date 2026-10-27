import { describe, expect, it } from 'vitest'

import {
  articleDirOf,
  articleRoutePath,
  articleUrlPath,
  isArticlePath,
  isArticleUrlPath,
  parseArticlePath,
} from '../.vitepress/support/article-path'

/**
 * 文章路径规则的回归锁。
 *
 * 重构后「文章在哪」只剩一种形态：`<locale>/<YYYYMM>/<DDNN>/index.md`。
 * 这条规则同时被构建期（`content.ts` / `config.ts` 的 rewrites）与命令行
 * （`scripts/lib/*`）使用，所以必须锁在纯函数层，不能靠端到端构建才发现。
 */

describe('parseArticlePath', () => {
  it('解析中文文章：年月 + 日序号', () => {
    expect(parseArticlePath('zh-cn/202610/1901/index.md')).toEqual({
      locale: 'zh-cn',
      month: '202610',
      daySeq: '1901',
      day: '19',
      sequence: '01',
      key: '202610/1901',
      dateKey: '20261019',
    })
  })

  it('解析英文文章', () => {
    expect(parseArticlePath('en/202610/2601/index.md')).toEqual({
      locale: 'en',
      month: '202610',
      daySeq: '2601',
      day: '26',
      sequence: '01',
      key: '202610/2601',
      dateKey: '20261026',
    })
  })

  it('容忍开头的斜杠', () => {
    expect(parseArticlePath('/zh-cn/202610/1901/index.md')?.key).toBe('202610/1901')
  })

  it('非文章形态一律返回 null', () => {
    // 首页 / pages 下的普通页面
    expect(parseArticlePath('zh-cn/index.md')).toBeNull()
    expect(parseArticlePath('zh-cn/pages/about/index.md')).toBeNull()
    expect(parseArticlePath('en/pages/tags/[tag]/index.md')).toBeNull()
    // 旧形态（已废弃，不做兼容）
    expect(parseArticlePath('zh-cn/posts/2026/10/19/01/index.md')).toBeNull()
    // 多加了标题目录
    expect(parseArticlePath('zh-cn/202610/1901/hello/index.md')).toBeNull()
    // 年月/日序号位数不对
    expect(parseArticlePath('zh-cn/2026/1901/index.md')).toBeNull()
    expect(parseArticlePath('zh-cn/202610/190/index.md')).toBeNull()
    // 文件名不是 index.md
    expect(parseArticlePath('zh-cn/202610/1901/post.md')).toBeNull()
    // 没有语言前缀
    expect(parseArticlePath('202610/1901/index.md')).toBeNull()
  })

  it('isArticlePath 与 parseArticlePath 口径一致', () => {
    expect(isArticlePath('zh-cn/202610/1901/index.md')).toBe(true)
    expect(isArticlePath('zh-cn/pages/about/index.md')).toBe(false)
  })
})

describe('articleRoutePath', () => {
  it('把 DDNN/index.md 换成 slug/index.md', () => {
    expect(articleRoutePath('zh-cn/202610/1901/index.md', '你好，世界')).toBe(
      'zh-cn/202610/1901/你好，世界/index.md',
    )
    expect(articleRoutePath('en/202610/1901/index.md', 'hello-world')).toBe(
      'en/202610/1901/hello-world/index.md',
    )
  })

  it('非文章返回 null', () => {
    expect(articleRoutePath('zh-cn/pages/about/index.md', 'about')).toBeNull()
  })
})

describe('articleUrlPath', () => {
  it('拼出带语言前缀与 slug 的地址（未编码、结尾带斜杠）', () => {
    expect(articleUrlPath('zh-cn', '202610', '1901', '你好，世界')).toBe(
      '/zh-cn/202610/1901/你好，世界/',
    )
    expect(articleUrlPath('en', '202610', '2601', 'markdown-syntax-test')).toBe(
      '/en/202610/2601/markdown-syntax-test/',
    )
  })
})

describe('articleDirOf', () => {
  it('年月拼成 YYYYMM，日与序号拼成四位 DDNN', () => {
    expect(articleDirOf({ year: '2026', month: '10', day: '19' }, '01')).toEqual({
      month: '202610',
      daySeq: '1901',
    })
    expect(articleDirOf({ year: '2026', month: '01', day: '05' }, '12')).toEqual({
      month: '202601',
      daySeq: '0512',
    })
  })
})

describe('isArticleUrlPath', () => {
  it('识别文章 URL 的裸形态（用于语言切换回退到列表页）', () => {
    expect(isArticleUrlPath('/202610/1901/你好，世界/')).toBe(true)
    expect(isArticleUrlPath('202610/1901/hello-world')).toBe(true)
  })

  it('不把普通页面误判成文章', () => {
    expect(isArticleUrlPath('/pages/about/')).toBe(false)
    expect(isArticleUrlPath('/pages/posts/')).toBe(false)
    expect(isArticleUrlPath('/')).toBe(false)
    // 文章 URL 必须同时有年月、日序号、slug 三段
    expect(isArticleUrlPath('/202610/1901/')).toBe(false)
    expect(isArticleUrlPath('/2026/1901/x/')).toBe(false)
  })
})
