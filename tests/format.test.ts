import { describe, expect, it } from 'vitest'

import { countWords, formatRfc822, parseDate, plainText, truncate } from '../.vitepress/support/format'

/** 日期与文本工具（纯函数，构建期与运行期共用）。 */

describe('plainText', () => {
  it('去掉 frontmatter', () => {
    expect(plainText('---\ntitle: x\n---\n\n正文')).toBe('正文')
  })

  it('去掉链接但保留文字', () => {
    expect(plainText('看 [这篇文章](https://example.com)。')).toBe('看 这篇文章。')
  })

  it('去掉图片', () => {
    expect(plainText('前 ![图](a.png) 后')).toBe('前 后')
  })

  it('去掉标题与列表标记', () => {
    expect(plainText('## 标题\n\n- 项目')).toBe('标题 项目')
  })
})

describe('countWords', () => {
  it('汉字按字计数', () => {
    expect(countWords('你好世界')).toBe(4)
  })

  it('拉丁按词计数', () => {
    expect(countWords('hello world')).toBe(2)
  })

  it('中英混排相加', () => {
    expect(countWords('hello 世界')).toBe(3)
  })

  it('空内容为 0', () => {
    expect(countWords('')).toBe(0)
  })
})

describe('parseDate', () => {
  it('接受 Date 对象', () => {
    const date = new Date('2026-10-19T04:09:28+08:00')
    expect(parseDate(date)?.getTime()).toBe(date.getTime())
  })

  it('接受 ISO 字符串', () => {
    expect(parseDate('2026-10-19T04:09:28+08:00')).toBeInstanceOf(Date)
  })

  it('非法值返回 null', () => {
    expect(parseDate('不是日期')).toBeNull()
    expect(parseDate(undefined)).toBeNull()
    expect(parseDate(new Date('invalid'))).toBeNull()
  })
})

describe('formatRfc822', () => {
  it('输出 RFC 822 格式（UTC 表示）', () => {
    // 2026-10-19 04:09:28 +08:00 == 2026-10-18 20:09:28 UTC
    const text = formatRfc822(new Date('2026-10-19T04:09:28+08:00'), 'Asia/Shanghai')
    expect(text).toBe('Sun, 18 Oct 2026 20:09:28 +0000')
  })

  it('日期与时间来自同一时刻，不出现自相矛盾的串', () => {
    // 回归：之前日期按站点时区算、时分秒按 UTC 算，会拼出 19 日 + 20:09 UTC
    const date = new Date('2026-10-19T04:09:28+08:00')
    const text = formatRfc822(date, 'Asia/Shanghai')
    expect(text).toContain('18 Oct')
    expect(text).not.toContain('19 Oct')
  })

  it('与时区参数无关（始终按 UTC 表示同一时刻）', () => {
    const date = new Date('2026-10-19T04:09:28+08:00')
    expect(formatRfc822(date, 'Asia/Shanghai')).toBe(formatRfc822(date, 'UTC'))
  })

  it('结尾是 +0000 而不是 GMT', () => {
    const text = formatRfc822(new Date('2026-01-01T00:00:00Z'), 'UTC')
    expect(text.endsWith('+0000')).toBe(true)
    expect(text).not.toContain('GMT')
  })
})

describe('truncate', () => {
  it('短文本原样返回', () => {
    expect(truncate('短', 10)).toBe('短')
  })

  it('超长时截断并加省略号', () => {
    expect(truncate('一二三四五', 3)).toBe('一二三…')
  })

  it('去掉首尾空白', () => {
    expect(truncate('  x  ', 10)).toBe('x')
  })
})
