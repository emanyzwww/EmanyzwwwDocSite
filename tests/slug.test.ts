import { describe, expect, it } from 'vitest'

import { isUsableSlug, slugify, slugOf } from '../.vitepress/support/slug'

/**
 * slug 规则的回归锁。
 *
 * 规则是拍板过的：**中文标题保留原样（含全角标点），纯拉丁标题走 kebab-case**。
 * 它决定文章 URL 的标题段，所以必须逐条锁住示例——尤其是下面这些
 * 「看起来能过、其实会被编码成怪地址」的写法。
 */

describe('slugify（含中文：保留原样）', () => {
  it('中文标题保留全角标点', () => {
    expect(slugify('你好，世界')).toBe('你好，世界')
  })

  it('中文里的空白与半角标点折叠成 -', () => {
    expect(slugify('Markdown 语法测试')).toBe('Markdown-语法测试')
    expect(slugify('重构: 一次改造')).toBe('重构-一次改造')
    expect(slugify('C++ 入门')).toBe('C-入门')
  })

  it('连续分隔符收敛，首尾不残留', () => {
    expect(slugify('  你好   世界  ')).toBe('你好-世界')
    expect(slugify('-你好-')).toBe('你好')
  })

  it('不会破坏 URL 的字符被保留', () => {
    // 全角标点、中文数字、emoji 都在 URL 里合法（会被百分号编码）
    expect(slugify('你好，世界！')).toBe('你好，世界！')
    expect(slugify('第一天：环境')).toBe('第一天：环境')
  })
})

describe('slugify（纯拉丁：kebab-case）', () => {
  it('小写 + 非字母数字变 -', () => {
    expect(slugify('Hello, World!')).toBe('hello-world')
    expect(slugify('Markdown Syntax Test')).toBe('markdown-syntax-test')
    expect(slugify('2026 年度总结')).toBe('2026-年度总结')
  })

  it('去变音符号', () => {
    expect(slugify('Café Déjà Vu')).toBe('cafe-deja-vu')
  })

  it('空标题返回空串（由 slugOf 兜底）', () => {
    expect(slugify('')).toBe('')
    expect(slugify('   ')).toBe('')
    expect(slugify('!!!')).toBe('')
  })
})

describe('isUsableSlug', () => {
  it('接受中文与全角标点', () => {
    expect(isUsableSlug('你好，世界')).toBe(true)
    expect(isUsableSlug('Markdown-语法测试')).toBe(true)
    expect(isUsableSlug('hello-world')).toBe(true)
  })

  it('拒绝会破坏 URL 的形态', () => {
    expect(isUsableSlug('')).toBe(false)
    expect(isUsableSlug('a/b')).toBe(false)
    expect(isUsableSlug('a?b')).toBe(false)
    expect(isUsableSlug('a#b')).toBe(false)
    expect(isUsableSlug('a b')).toBe(false)
    expect(isUsableSlug(' 前后有空格 ')).toBe(false)
    expect(isUsableSlug('-前后有连字符-')).toBe(false)
    expect(isUsableSlug('.')).toBe(false)
    expect(isUsableSlug('..')).toBe(false)
    expect(isUsableSlug('.hidden')).toBe(false)
    expect(isUsableSlug('结尾有点.')).toBe(false)
  })

  it('允许出现在 slug 中间的点（`重构 2.0` → `重构-2.0`）', () => {
    expect(isUsableSlug('重构-2.0')).toBe(true)
  })
})

describe('slugOf', () => {
  it('显式 slug 可用时优先', () => {
    expect(slugOf({ title: '你好，世界', slug: 'hello-world' })).toBe('hello-world')
  })

  it('缺 slug 时由 title 推导', () => {
    expect(slugOf({ title: '你好，世界' })).toBe('你好，世界')
    expect(slugOf({ title: 'Hello, World!' })).toBe('hello-world')
  })

  it('显式 slug 不可用时退回推导值（不让坏值进 URL）', () => {
    expect(slugOf({ title: 'Hello, World!', slug: 'a/b' })).toBe('hello-world')
  })

  it('推导不出来时回退 untitled', () => {
    expect(slugOf({ title: '!!!' })).toBe('untitled')
    expect(slugOf({})).toBe('untitled')
  })
})
