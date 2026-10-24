/**
 * 脚本内核的单元测试。
 *
 * 这些函数决定了「文章建在哪、序号是几、frontmatter 长什么样」，
 * 一旦错了会静默写坏内容（比如把两篇文章塞进同一个目录），因此必须有测试。
 * 全部是纯函数或只读文件的函数，不写盘。
 */

import { describe, expect, it } from 'vitest'

import { parseArgs, optionValue, hasOption } from '../scripts/lib/args'
import { nextSequence, slugify, buildFrontmatterData } from '../scripts/lib/create'
import {
  formatZonedIso,
  isoDateInZone,
  parseCompactDate,
  splitZoned,
  zonedOffset,
} from '../scripts/lib/dates'
import {
  isCanonicalKeyOrder,
  needsQuoting,
  rawScalarValue,
  stringifyFrontmatter,
} from '../scripts/lib/frontmatter'
import { parsePostPath } from '../scripts/lib/posts'
import { displayWidth, padEnd, truncateByWidth } from '../scripts/lib/ui'
import { compareRows } from '../scripts/posts'

const TZ = 'Asia/Shanghai'

describe('splitZoned / isoDateInZone', () => {
  it('按北京时间拆分时刻', () => {
    // 2026-10-19 04:09:28 +08:00
    const date = new Date('2026-10-19T04:09:28+08:00')
    expect(splitZoned(date, TZ)).toMatchObject({
      year: '2026',
      month: '10',
      day: '19',
      hour: '04',
      minute: '09',
    })
  })

  it('UTC 日期与北京时间日期在跨日时不同（关键回归）', () => {
    // 北京时间 10-19 04:09 == UTC 10-18 20:09
    const date = new Date('2026-10-19T04:09:28+08:00')
    expect(date.toISOString().slice(0, 10)).toBe('2026-10-18') // UTC：前一天
    expect(isoDateInZone(date, TZ)).toBe('2026-10-19') // 站点时区：正确
  })

  it('午夜边界仍取当天', () => {
    const date = new Date('2026-10-24T00:00:00+08:00')
    expect(isoDateInZone(date, TZ)).toBe('2026-10-24')
  })

  it('输出 h23 小时，不出现 24 时', () => {
    const date = new Date('2026-10-24T23:59:59+08:00')
    expect(splitZoned(date, TZ).hour).toBe('23')
  })
})

describe('zonedOffset / formatZonedIso', () => {
  it('北京时间为 +08:00', () => {
    expect(zonedOffset(new Date('2026-10-24T22:49:28+08:00'), TZ)).toBe('+08:00')
  })

  it('生成带时区的完整 ISO 串', () => {
    const date = new Date('2026-10-24T22:49:28+08:00')
    expect(formatZonedIso(date, TZ)).toBe('2026-10-24T22:49:28+08:00')
  })

  it('生成结果与站点时区的日期一致', () => {
    const date = new Date('2026-10-19T04:09:28+08:00')
    expect(formatZonedIso(date, TZ).startsWith(isoDateInZone(date, TZ))).toBe(true)
  })
})

describe('parseCompactDate', () => {
  it('解析 8 位日期', () => {
    expect(parseCompactDate('20261024')).toEqual({ year: '2026', month: '10', day: '24' })
  })

  it('位数不对时抛错', () => {
    expect(() => parseCompactDate('2026102')).toThrow(/8 位数字/)
    expect(() => parseCompactDate('2026-10-24')).toThrow(/8 位数字/)
  })

  it('月份越界时抛错', () => {
    expect(() => parseCompactDate('20261324')).toThrow(/月份不合法/)
  })

  it('日期越界时抛错（不静默滚到次月）', () => {
    expect(() => parseCompactDate('20260230')).toThrow(/日期不合法/)
    expect(() => parseCompactDate('20261032')).toThrow(/日期不合法/)
  })

  it('闰年 2 月 29 合法', () => {
    expect(parseCompactDate('20280229')).toEqual({ year: '2028', month: '02', day: '29' })
  })
})

describe('nextSequence', () => {
  it('空目录从 01 开始', () => {
    expect(nextSequence(new Set())).toBe('01')
  })

  it('依次递增', () => {
    expect(nextSequence(new Set(['01']))).toBe('02')
    expect(nextSequence(new Set(['01', '02']))).toBe('03')
  })

  it('优先补空洞', () => {
    expect(nextSequence(new Set(['01', '03']))).toBe('02')
    expect(nextSequence(new Set(['01', '02', '04']))).toBe('03')
  })

  it('忽略非两位数字的目录名', () => {
    expect(nextSequence(new Set(['hello', '01']))).toBe('02')
  })

  it('超过 99 时抛错而不是变成三位', () => {
    const used = new Set(
      Array.from({ length: 99 }, (_, index) => String(index + 1).padStart(2, '0')),
    )
    expect(() => nextSequence(used)).toThrow(/上限 99/)
  })
})

describe('slugify', () => {
  it('英文标题转 kebab-case', () => {
    expect(slugify('Hello World')).toBe('hello-world')
  })

  it('中文标题保留原字', () => {
    expect(slugify('我的新文章')).toBe('我的新文章')
  })

  it('去掉标点与空格', () => {
    expect(slugify('你好，世界！')).toBe('你好世界')
  })

  it('去掉方括号（动态路由语法）', () => {
    expect(slugify('[草稿] 标题')).toBe('草稿-标题')
  })
})

describe('buildFrontmatterData', () => {
  it('补齐全部字段（用户要求「全部补上」）', () => {
    const data = buildFrontmatterData({
      title: '标题',
      date: '2026-10-24T22:49:28+08:00',
    })

    expect(Object.keys(data)).toEqual(['title', 'date', 'tags', 'description', 'draft', 'outline'])
    expect(data.tags).toEqual([])
    expect(data.description).toBe('')
    expect(data.draft).toBe(false)
    expect(data.outline).toBe(true)
  })

  it('保留传入的值', () => {
    const data = buildFrontmatterData({
      title: '标题',
      date: '2026-10-24T22:49:28+08:00',
      tags: ['随笔'],
      description: '摘要',
      draft: true,
      outline: false,
    })

    expect(data).toMatchObject({
      tags: ['随笔'],
      description: '摘要',
      draft: true,
      outline: false,
    })
  })
})

describe('needsQuoting', () => {
  it('普通中文不需要引号', () => {
    expect(needsQuoting('你好，世界')).toBe(false)
  })

  it('含 ": " 需要引号（映射语法）', () => {
    expect(needsQuoting('标题: 副标题')).toBe(true)
  })

  it('含 " #" 需要引号（注释语法）', () => {
    expect(needsQuoting('a # b')).toBe(true)
  })

  it('形似布尔/数字需要引号', () => {
    expect(needsQuoting('true')).toBe(true)
    expect(needsQuoting('2026')).toBe(true)
  })

  it('空字符串需要引号', () => {
    expect(needsQuoting('')).toBe(true)
  })

  it('以结构标记开头需要引号', () => {
    expect(needsQuoting('- 前缀')).toBe(true)
    expect(needsQuoting('[x]')).toBe(true)
  })
})

describe('stringifyFrontmatter', () => {
  it('输出与仓库现有文章一致的风格', () => {
    const text = stringifyFrontmatter(
      {
        title: '你好，世界',
        date: '2026-10-19T04:09:28+08:00',
        tags: ['随笔'],
        description: '一句话摘要。',
      },
      '正文。\n',
    )

    expect(text).toBe(
      [
        '---',
        'title: 你好，世界',
        'date: 2026-10-19T04:09:28+08:00',
        "tags: ['随笔']",
        'description: 一句话摘要。',
        '---',
        '',
        '正文。',
        '',
      ].join('\n'),
    )
  })

  it('空标签写 []', () => {
    const text = stringifyFrontmatter({ title: 'x', tags: [] }, '')
    expect(text).toContain('tags: []')
  })

  it('有歧义的值加引号', () => {
    const text = stringifyFrontmatter({ title: '标题: 副标题' }, '')
    expect(text).toContain("title: '标题: 副标题'")
  })

  it('保留未知字段（不静默丢弃）', () => {
    const text = stringifyFrontmatter({ title: 'x', custom: 'y' }, '')
    expect(text).toContain('custom: y')
  })

  it('多个标签内联', () => {
    const text = stringifyFrontmatter({ tags: ['随笔', '工具'] }, '')
    expect(text).toContain("tags: ['随笔', '工具']")
  })

  /*
   * 回归：`gray-matter` 把日期解析成 `Date`，早期序列化器对它调用了 `String()`，
   * 于是把一个正常的 frontmatter 写成了
   * `date: Mon Oct 19 2026 04:09:28 GMT+0800 (China Standard Time)`。
   * 这条测试确保「Date 进来也只能输出合法 ISO 串」。
   */
  it('Date 对象输出为带时区的 ISO 串，而不是 Date 的字符串形式', () => {
    const text = stringifyFrontmatter(
      { title: 'x', date: new Date('2026-10-19T04:09:28+08:00') },
      '',
    )
    expect(text).toContain('date: 2026-10-19T04:09:28+08:00')
    expect(text).not.toContain('GMT')
    expect(text).not.toContain('Mon Oct')
  })

  it('字符串日期原样保留（不重新格式化）', () => {
    const text = stringifyFrontmatter({ date: '2026-10-24T00:00:00+08:00' }, '')
    expect(text).toContain('date: 2026-10-24T00:00:00+08:00')
  })
})

describe('rawScalarValue', () => {
  const raw = [
    '---',
    'title: 你好，世界',
    'date: 2026-10-19T04:09:28+08:00',
    '---',
    '',
    '正文',
  ].join('\n')

  it('取出原始字面量', () => {
    expect(rawScalarValue(raw, 'date')).toBe('2026-10-19T04:09:28+08:00')
  })

  it('取出中文值', () => {
    expect(rawScalarValue(raw, 'title')).toBe('你好，世界')
  })

  it('不存在的键返回 undefined', () => {
    expect(rawScalarValue(raw, 'tags')).toBeUndefined()
  })

  it('去掉包裹的引号', () => {
    const quoted = ['---', "title: '标题: 副标题'", '---', ''].join('\n')
    expect(rawScalarValue(quoted, 'title')).toBe('标题: 副标题')
  })
})

describe('isCanonicalKeyOrder', () => {
  it('规范顺序返回 true', () => {
    expect(isCanonicalKeyOrder(['title', 'date', 'tags'])).toBe(true)
  })

  it('乱序返回 false', () => {
    expect(isCanonicalKeyOrder(['date', 'title'])).toBe(false)
  })

  it('未知字段穿插不影响判定', () => {
    expect(isCanonicalKeyOrder(['title', 'custom', 'date'])).toBe(true)
  })
})

describe('parseArgs', () => {
  const specs = [
    { name: 'lang', short: 'l' },
    { name: 'draft', boolean: true },
  ]

  it('解析 -l=zh-cn', () => {
    const args = parseArgs(['-l=zh-cn'], specs)
    expect(optionValue(args, 'lang')).toBe('zh-cn')
  })

  it('解析 --lang zh-cn', () => {
    const args = parseArgs(['--lang', 'zh-cn'], specs)
    expect(optionValue(args, 'lang')).toBe('zh-cn')
  })

  it('解析布尔开关', () => {
    const args = parseArgs(['--draft'], specs)
    expect(hasOption(args, 'draft')).toBe(true)
  })

  it('收集位置参数', () => {
    const args = parseArgs(['20261024', '-l=zh-cn'], specs)
    expect(args.positionals).toEqual(['20261024'])
  })

  it('剥掉 pnpm 透传的 --', () => {
    const args = parseArgs(['--', '--lang=en'], specs)
    expect(optionValue(args, 'lang')).toBe('en')
  })

  it('未知参数抛错', () => {
    expect(() => parseArgs(['--nope'], specs)).toThrow(/不认识的参数/)
  })

  it('缺值抛错', () => {
    expect(() => parseArgs(['--lang'], specs)).toThrow(/缺少值/)
  })
})

describe('displayWidth / padEnd / truncateByWidth', () => {
  it('中文按 2 列宽', () => {
    expect(displayWidth('中文')).toBe(4)
  })

  it('英文按 1 列宽', () => {
    expect(displayWidth('ab')).toBe(2)
  })

  it('中英混排相加', () => {
    expect(displayWidth('a中')).toBe(3)
  })

  it('按显示宽度补齐', () => {
    expect(displayWidth(padEnd('中文', 8))).toBe(8)
  })

  it('超宽时截断并加省略号', () => {
    const result = truncateByWidth('一二三四五', 5)
    expect(displayWidth(result)).toBeLessThanOrEqual(5)
    expect(result.endsWith('…')).toBe(true)
  })
})

describe('parsePostPath', () => {
  it('解析符合约定的路径', () => {
    const info = parsePostPath('zh-cn/posts/2026/10/19/01/hello-world/index.md', 'zh-cn')
    expect(info).toMatchObject({
      locale: 'zh-cn',
      year: '2026',
      month: '10',
      day: '19',
      sequence: '01',
      slug: 'hello-world',
      compliant: true,
      url: '/zh-cn/posts/2026/10/19/01/hello-world/',
    })
  })

  it('平铺写法标记为不符合约定但不报错', () => {
    const info = parsePostPath('zh-cn/posts/hello/index.md', 'zh-cn')
    expect(info.compliant).toBe(false)
    expect(info.slug).toBe('hello')
    expect(info.deviation).toMatch(/目录层级/)
  })

  it('日期层级写错时给出原因', () => {
    const info = parsePostPath('zh-cn/posts/2026/1/19/01/x/index.md', 'zh-cn')
    expect(info.compliant).toBe(false)
    expect(info.deviation).toMatch(/日期层级/)
  })

  it('识别英文语言', () => {
    const info = parsePostPath('en/posts/2026/10/19/01/hello-world/index.md', 'zh-cn')
    expect(info.locale).toBe('en')
  })
})

describe('compareRows', () => {
  /** 造一行排序数据。 */
  const row = (title: string, iso: string, sequence: string) => ({
    title,
    time: new Date(iso).getTime(),
    sequence,
  })

  it('新的在前', () => {
    const older = row('旧', '2026-10-19T04:00:00+08:00', '01')
    const newer = row('新', '2026-10-24T22:00:00+08:00', '01')
    expect([older, newer].toSorted(compareRows)).toEqual([newer, older])
  })

  /*
   * 回归：同一天的三篇必须按序号排列。
   * 早期按 `YYYY-MM-DD` 字符串比较，同一天全部相等，于是退回按标题排序，
   * 实测显示成 `01 未命名文章 / 03 第三篇 / 02 第二篇`。
   */
  it('同一天按序号正序排（不按标题）', () => {
    const a = row('未命名文章', '2026-10-24T23:54:51+08:00', '01')
    const b = row('第二篇', '2026-10-24T23:55:10+08:00', '02')
    const c = row('第三篇', '2026-10-24T23:55:20+08:00', '03')

    // 输入故意打乱，且标题顺序与序号顺序相反
    expect([a, c, b].toSorted(compareRows)).toEqual([c, b, a])
  })

  it('时刻完全相同时按序号正序', () => {
    const same = '2026-10-24T22:00:00+08:00'
    const a = row('甲', same, '01')
    const b = row('乙', same, '02')
    expect([b, a].toSorted(compareRows)).toEqual([a, b])
  })

  it('缺序号的排在同刻有序号之后', () => {
    const same = '2026-10-24T22:00:00+08:00'
    const withSeq = row('有号', same, '01')
    const noSeq = row('无号', same, '')
    expect([noSeq, withSeq].toSorted(compareRows)).toEqual([withSeq, noSeq])
  })
})
