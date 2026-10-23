import { describe, expect, it } from 'vitest'

import { asLocale, DEFAULT_LOCALE, LOCALE_CODES, LOCALES } from '../.vitepress/data/site'
import {
  localeOfPath,
  postListPath,
  stripBase,
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

describe('stripBase', () => {
  it('去掉部署子路径', () => {
    expect(stripBase('/repo/zh-cn/about/', '/repo/')).toBe('/zh-cn/about/')
    expect(stripBase('/repo/', '/repo/')).toBe('/')
  })

  it('base 为根部署时是恒等函数', () => {
    expect(stripBase('/zh-cn/about/', '/')).toBe('/zh-cn/about/')
    expect(stripBase('/zh-cn/about/', '')).toBe('/zh-cn/about/')
  })

  it('base 结尾不带斜杠也正确', () => {
    expect(stripBase('/repo/zh-cn/about/', '/repo')).toBe('/zh-cn/about/')
  })

  it('不误伤以 base 同名前缀开头的其它路径', () => {
    // /repository/ 不该被 /repo 剥成 /sitory/
    expect(stripBase('/repository/x/', '/repo/')).toBe('/repository/x/')
  })

  it('不带 base 的路径原样返回', () => {
    expect(stripBase('/zh-cn/about/', '/repo/')).toBe('/zh-cn/about/')
  })
})

/**
 * 回归测试：GitHub Pages 子路径部署下，`route.path` 是**含 base** 的，
 * 而站点内所有内容路径（`pages.data.ts` 的 `readPageUrls()`）**不含 base**。
 *
 * 线上曾因此让「语言切换」永远退回目标语言首页、导航高亮全站失效。
 * 本地 dev 的 base 是 `/`，这个 bug 在本地完全看不出来，所以必须在此锁住。
 */
describe('剥离顺序：先 stripBase 再 stripLocale', () => {
  const BASE = '/EmanyzwwwDocSite/'

  it('子路径部署下能得到正确的不含 base 的裸路径', () => {
    expect(stripLocale(stripBase('/EmanyzwwwDocSite/zh-cn/about/', BASE))).toBe('/about/')
    expect(stripLocale(stripBase('/EmanyzwwwDocSite/en/posts/', BASE))).toBe('/posts/')
  })

  it('语言首页也一样', () => {
    expect(stripLocale(stripBase('/EmanyzwwwDocSite/zh-cn/', BASE))).toBe('/')
    expect(stripLocale(stripBase('/EmanyzwwwDocSite/en/', BASE))).toBe('/')
  })

  it('顺序反了就得不出正确结果（这正是线上 bug 的成因）', () => {
    // 先剥语言：路径开头是 /EmanyzwwwDocSite，语言正则匹配不上
    expect(stripLocale('/EmanyzwwwDocSite/zh-cn/about/')).toBe('/EmanyzwwwDocSite/zh-cn/about/')
  })

  it('能从裸路径重建出目标语言的对应页面', () => {
    const bare = stripLocale(stripBase('/EmanyzwwwDocSite/zh-cn/about/', BASE))
    expect(withLocale(bare, 'en')).toBe('/en/about/')
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
