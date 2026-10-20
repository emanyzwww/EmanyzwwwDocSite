import { describe, expect, it } from 'vitest'

import { pickLocale } from '../.vitepress/support/dev-redirect'

/** dev 阶段根路径的语言判定（生产构建走 public/index.html，规则相同）。 */

describe('pickLocale', () => {
  it('按 q 值顺序取第一个能匹配的语言', () => {
    expect(pickLocale('en-US,en;q=0.9')).toBe('en')
    expect(pickLocale('zh-CN,zh;q=0.9')).toBe('zh-cn')
  })

  it('把 zh-* 的各种写法都归到简体中文', () => {
    expect(pickLocale('zh')).toBe('zh-cn')
    expect(pickLocale('zh-Hans-CN')).toBe('zh-cn')
    expect(pickLocale('zh-TW')).toBe('zh-cn')
  })

  it('匹配不上时落到默认语言', () => {
    expect(pickLocale('fr-FR,fr;q=0.9')).toBe('zh-cn')
    expect(pickLocale('')).toBe('zh-cn')
    expect(pickLocale(undefined)).toBe('zh-cn')
  })

  it('跳过不支持的语言，取下一个能匹配的', () => {
    expect(pickLocale('ja,en;q=0.5')).toBe('en')
  })

  it('大小写不敏感', () => {
    expect(pickLocale('EN-us')).toBe('en')
    expect(pickLocale('ZH-cn')).toBe('zh-cn')
  })

  it('容忍多余空白', () => {
    expect(pickLocale(' en-US , en ; q=0.9 ')).toBe('en')
  })
})
