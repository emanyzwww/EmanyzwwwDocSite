import { describe, expect, it } from 'vitest'

import {
  countWords,
  formatRfc822,
  formatUpdatedDate,
  isDuplicateOpening,
  isMeaningfulUpdate,
  normalizeComparable,
  parseDate,
  plainText,
  readingMinutes,
  textStats,
  truncate,
} from '../.vitepress/support/format'

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

describe('textStats / readingMinutes', () => {
  it('汉字与拉丁词分开统计', () => {
    expect(textStats('你好 世界 hello')).toEqual({ han: 4, latin: 1 })
  })

  it('中英混排按各自阅读速度折算（中文 350 字/分，英文 200 词/分）', () => {
    // 700 汉字 = 2 分钟；400 拉丁词 = 2 分钟 → 合计 4 分钟
    expect(readingMinutes('好'.repeat(700) + ' ' + Array(400).fill('word').join(' '))).toBe(4)
  })

  it('不足 1 分钟按 1 分钟（读者的感知下限不是 0）', () => {
    expect(readingMinutes('短句')).toBe(1)
    expect(readingMinutes('')).toBe(1)
  })

  it('只有标点/空白时也是 1 分钟', () => {
    expect(readingMinutes('—— ！？')).toBe(1)
  })

  it('与字数统计同源（字数多不等于分钟数按字数直接除）', () => {
    // 纯汉字：1000 字 → 1000/350 ≈ 2.86 → 3 分钟
    expect(readingMinutes('好'.repeat(1000))).toBe(3)
  })
})

describe('normalizeComparable / isDuplicateOpening', () => {
  it('标点与空白不影响比较', () => {
    expect(normalizeComparable('「hello, world」')).toBe('helloworld')
  })

  it('导语与正文首段是同一句（只是引号写法不同）→ 判为重复', () => {
    const lead = '在搞机这个行业里，亲手完成一个「hello, world」项目。'
    const opening = '在搞机这个行业里，亲手完成一个“hello, world”项目。'
    expect(isDuplicateOpening(lead, opening)).toBe(true)
  })

  it('导语是正文首段的前缀 → 也判为重复', () => {
    expect(isDuplicateOpening('一句话导语。', '一句话导语。后面还有正文。')).toBe(true)
  })

  it('内容不同 → 不重复（可以显示导语）', () => {
    expect(isDuplicateOpening('本文讲双主题代码块。', '在搞机这个行业里……')).toBe(false)
  })

  it('任一侧为空 → 不判重复（交给显示层决定）', () => {
    expect(isDuplicateOpening('', '正文')).toBe(false)
    expect(isDuplicateOpening('导语', '')).toBe(false)
  })
})

describe('formatUpdatedDate / isMeaningfulUpdate', () => {
  const publish = new Date('2026-10-19T04:09:28+08:00')

  it('同年只显示 MM-DD，跨年才带 YYYY', () => {
    const sameYear = new Date('2026-10-28T09:00:00+08:00')
    expect(formatUpdatedDate(sameYear, 'Asia/Shanghai', '2026')).toBe('10-28')

    const nextYear = new Date('2027-01-02T09:00:00+08:00')
    expect(formatUpdatedDate(nextYear, 'Asia/Shanghai', '2026')).toBe('2027-01-02')
  })

  it('晚于发布日 → 值得显示（跨天）', () => {
    const updated = new Date('2026-10-28T09:00:00+08:00')
    expect(isMeaningfulUpdate(publish, updated, 'Asia/Shanghai')).toBe(true)
  })

  it('同一天改字 → 不显示「更新于」', () => {
    const sameDay = new Date('2026-10-19T23:00:00+08:00')
    expect(isMeaningfulUpdate(publish, sameDay, 'Asia/Shanghai')).toBe(false)
  })

  it('写错（早于发布日 / 没有更新）→ 不显示', () => {
    expect(isMeaningfulUpdate(publish, new Date('2026-10-01T00:00:00+08:00'), 'Asia/Shanghai')).toBe(
      false,
    )
    expect(isMeaningfulUpdate(publish, null, 'Asia/Shanghai')).toBe(false)
  })

  it('按站点时区判断「哪一天」，不看构建机时区', () => {
    // 上海 20 日 01:00（= 19 日 17:00Z）相对上海 19 日 23:00 是「第二天」；
    // 但在 UTC 下两者都是 19 日 —— 同一条数据，两个时区结论相反。
    const published = new Date('2026-10-19T23:00:00+08:00')
    const updated = new Date('2026-10-20T01:00:00+08:00')
    expect(isMeaningfulUpdate(published, updated, 'Asia/Shanghai')).toBe(true)
    expect(isMeaningfulUpdate(published, updated, 'UTC')).toBe(false)
  })
})
