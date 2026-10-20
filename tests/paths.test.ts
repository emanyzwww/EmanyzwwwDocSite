import { describe, expect, it } from 'vitest'

import { asLocale, DEFAULT_LOCALE, LOCALE_CODES, LOCALES } from '../.vitepress/data/site'
import {
  localeOfPath,
  postListPath,
  stripLocale,
  withLocale,
} from '../.vitepress/support/locale-paths'

/** 语言前缀换算。中英是平级前缀，没有「默认语言不带前缀」的特例。 */

describe('asLocale', () => {
  it('接受合法语言代码', () => {
    expect(asLocale('zh-cn')).toBe('zh-cn')
    expect(asLocale('en')).toBe('en')
  })

  it('非法值回退到默认语言', () => {
    expect(asLocale('fr')).toBe(DEFAULT_LOCALE)
    expect(asLocale(undefined)).toBe(DEFAULT_LOCALE)
    expect(asLocale('')).toBe(DEFAULT_LOCALE)
  })
})

describe('localeOfPath', () => {
  it('取第一段作为语言', () => {
    expect(localeOfPath('/zh-cn/about/')).toBe('zh-cn')
    expect(localeOfPath('/en/posts/')).toBe('en')
  })

  it('匹配不上时归默认语言', () => {
    expect(localeOfPath('/')).toBe(DEFAULT_LOCALE)
    expect(localeOfPath('/unknown/')).toBe(DEFAULT_LOCALE)
  })
})

describe('stripLocale', () => {
  it('去掉语言前缀', () => {
    expect(stripLocale('/zh-cn/about/')).toBe('/about/')
    expect(stripLocale('/en/posts/')).toBe('/posts/')
  })

  it('语言首页去掉前缀后是 /', () => {
    expect(stripLocale('/zh-cn/')).toBe('/')
    expect(stripLocale('/en/')).toBe('/')
  })

  it('不带语言前缀的路径原样返回', () => {
    expect(stripLocale('/about/')).toBe('/about/')
  })

  it('不误伤同前缀的其它路径', () => {
    // /english/ 不该被当成 /en 前缀剥掉
    expect(stripLocale('/english/')).toBe('/english/')
  })
})

describe('withLocale', () => {
  it('给普通路径加前缀', () => {
    expect(withLocale('/posts/', 'zh-cn')).toBe('/zh-cn/posts/')
    expect(withLocale('/posts/', 'en')).toBe('/en/posts/')
  })

  it('根路径变成语言首页', () => {
    expect(withLocale('/', 'zh-cn')).toBe('/zh-cn/')
    expect(withLocale('/', 'en')).toBe('/en/')
  })

  it('与 stripLocale 互逆', () => {
    for (const locale of LOCALE_CODES) {
      expect(stripLocale(withLocale('/about/', locale))).toBe('/about/')
    }
  })
})

describe('postListPath', () => {
  it('第 1 页不带 /page/1/', () => {
    expect(postListPath('zh-cn', 1)).toBe('/zh-cn/posts/')
  })

  it('第 2 页起带页码', () => {
    expect(postListPath('zh-cn', 2)).toBe('/zh-cn/posts/page/2/')
    expect(postListPath('en', 3)).toBe('/en/posts/page/3/')
  })
})

describe('LOCALES 配置', () => {
  it('LOCALE_CODES 与 LOCALES 的键一致', () => {
    expect(LOCALE_CODES.sort()).toEqual(Object.keys(LOCALES).sort())
  })

  it('每种语言都有非空 lang / label / title', () => {
    for (const code of LOCALE_CODES) {
      const meta = LOCALES[code]
      expect(meta.lang).toBeTruthy()
      expect(meta.label).toBeTruthy()
      expect(meta.title).toBeTruthy()
      expect(meta.code).toBe(code)
    }
  })

  it('默认语言在 LOCALE_CODES 里', () => {
    expect(LOCALE_CODES).toContain(DEFAULT_LOCALE)
  })
})
