import { describe, expect, it } from 'vitest'

import {
  buildSrcset,
  decideKind,
  DISPLAY_WIDTHS,
  KEY_LENGTH,
  ladderWidths,
  lqipFileName,
  originFileName,
  pickSrcWidth,
  planWidths,
  shortKey,
  SIZES,
  variantFileName,
  withBase,
} from '../.vitepress/support/media/planner'

/**
 * 媒体管线的纯函数层。
 *
 * 这一层刻意不碰文件系统、不 import sharp，所以能在 Node 里直接跑
 * （与 `tests/` 只测纯函数的约定一致，见 DEVELOPING.md 第九节）。
 *
 * 断言里的期望值大多来自实测：档位退化用的是仓库里那张 1672×941 的 banner，
 * 断点 704 是 `42rem(672px) + 两侧 16px` 的推导结果。
 */

describe('decideKind（格式裁决）', () => {
  it('位图走转码', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'avif']) {
      expect(decideKind(ext)).toEqual({ kind: 'raster', transcode: true })
    }
  })

  it('扩展名大小写与前导点都能接受', () => {
    expect(decideKind('PNG').kind).toBe('raster')
    expect(decideKind('.JPG').kind).toBe('raster')
  })

  it('svg 不转码（栅格化是降级）', () => {
    expect(decideKind('svg')).toEqual({ kind: 'vector', transcode: false })
  })

  it('gif 转 animated webp，且标记为动图', () => {
    expect(decideKind('gif')).toEqual({ kind: 'animated', transcode: true })
  })

  it('tiff / heic 能转，但要给作者一句提醒', () => {
    for (const ext of ['tiff', 'tif', 'heic', 'heif']) {
      const decision = decideKind(ext)
      expect(decision.transcode).toBe(true)
      expect(decision.warning).toContain('浏览器')
    }
  })

  it('bmp 直接报错，且报错文案告诉作者该换成什么', () => {
    expect(() => decideKind('bmp')).toThrow(/PNG/)
    expect(() => decideKind('psd')).toThrow(/PNG/)
    expect(() => decideKind('ico')).toThrow(/PNG/)
  })

  it('未知格式报错并列出支持的格式', () => {
    expect(() => decideKind('heif2')).toThrow(/不支持/)
    expect(() => decideKind('xyz')).toThrow(/支持/)
  })
})

describe('ladderWidths（档位）', () => {
  it('正常尺寸出三档 + 补一档原宽', () => {
    expect(ladderWidths(1200)).toEqual([336, 672, 1008, 1200])
  })

  it('超宽图补到 MASTER_CAP(2016) 而不是原宽', () => {
    // 不补 3000：那会多出一份比 2016 还大的展示图，收益只在 3× DPR 时才体现
    expect(ladderWidths(3000)).toEqual([336, 672, 1008, 2016])
  })

  it('永不放大：每档都不超过固有宽度', () => {
    for (const width of [1200, 1000, 900, 800, 700, 672, 600, 400]) {
      for (const step of ladderWidths(width)) {
        expect(step).toBeLessThanOrEqual(width)
      }
    }
  })

  it('比最小档还小的图只出一档 = 原宽', () => {
    expect(ladderWidths(300)).toEqual([300])
    expect(ladderWidths(100)).toEqual([100])
  })

  it('刚好等于某档时不重复出档', () => {
    // 672 宽的源图仍然该出 336 那档：窄屏 @1x 只需要 328px
    expect(ladderWidths(672)).toEqual([336, 672])
    expect(ladderWidths(1008)).toEqual([336, 672, 1008])
  })

  it('非法输入返回空数组（不抛错，交给调用方降级）', () => {
    expect(ladderWidths(0)).toEqual([])
    expect(ladderWidths(-5)).toEqual([])
    expect(ladderWidths(Number.NaN)).toEqual([])
  })

  it('结果始终升序且唯一', () => {
    for (const width of [100, 336, 672, 1008, 1500, 2016, 4000]) {
      const widths = ladderWidths(width)
      expect(widths).toEqual([...new Set(widths)].toSorted((a, b) => a - b))
    }
  })
})

describe('planWidths（按媒体类型）', () => {
  it('矢量不出任何档位', () => {
    expect(planWidths('vector', 1672)).toEqual([])
  })

  it('动图只出一档（避免文件数乘上帧数）', () => {
    expect(planWidths('animated', 800)).toEqual([800])
    expect(planWidths('animated', 3000)).toEqual([2016])
  })

  it('位图走完整梯子', () => {
    expect(planWidths('raster', 1200)).toEqual([336, 672, 1008, 1200])
  })
})

describe('pickSrcWidth（src 该用哪一档）', () => {
  it('优先取不小于 672 的最小档', () => {
    expect(pickSrcWidth([336, 672, 1008, 1200])).toBe(672)
    expect(pickSrcWidth([336, 1008])).toBe(1008)
  })

  it('都小于 672 时取最大档', () => {
    expect(pickSrcWidth([336, 500])).toBe(500)
    expect(pickSrcWidth([300])).toBe(300)
  })

  it('空数组返回 0（调用方据此判断是否有多档）', () => {
    expect(pickSrcWidth([])).toBe(0)
  })
})

describe('命名规则', () => {
  it('短指纹取前 KEY_LENGTH 位', () => {
    const key = 'a'.repeat(64)
    expect(shortKey(key)).toHaveLength(KEY_LENGTH)
    expect(shortKey(key)).toBe('a'.repeat(12))
  })

  it('同 sha + 同宽 → 同文件名（这是跨文章去重的全部秘密）', () => {
    const key = 'd'.repeat(64)
    expect(variantFileName(key, 672)).toBe(variantFileName(key, 672))
  })

  it('同 sha + 不同宽 → 不同文件名', () => {
    const key = 'd'.repeat(64)
    expect(variantFileName(key, 672)).not.toBe(variantFileName(key, 1008))
  })

  it('原图与变体分目录，且保留原扩展名', () => {
    const key = 'e'.repeat(64)
    expect(originFileName(key, 'PNG')).toBe('assets/media/orig/eeeeeeeeeeee.png')
    expect(variantFileName(key, 672)).toBe('assets/media/eeeeeeeeeeee-672.webp')
  })

  it('文件名里不含平台 / 时间戳（跨平台稳定）', () => {
    const name = variantFileName('f'.repeat(64), 672)
    expect(name).toMatch(/^assets\/media\/f{12}-\d+\.webp$/)
  })

  it('LQIP 文件名：同 sha 唯一、不带宽度档、与展示变体不同名', () => {
    const key = 'd'.repeat(64)
    const name = lqipFileName(key)
    expect(name).toBe('assets/media/dddddddddddd-lqip.webp')
    expect(name).not.toBe(variantFileName(key, 672))
    expect(name).not.toBe(variantFileName(key, 336))
  })
})

describe('buildSrcset', () => {
  it('按 width 降序无关，保持传入顺序并带 w 描述符', () => {
    expect(
      buildSrcset([
        { width: 336, fileName: '/a-336.webp' },
        { width: 672, fileName: '/a-672.webp' },
      ]),
    ).toBe('/a-336.webp 336w, /a-672.webp 672w')
  })

  it('空数组得到空串', () => {
    expect(buildSrcset([])).toBe('')
  })
})

describe('sizes 常量', () => {
  it('断点是 704 = 672 + 32（两侧各 16）', () => {
    // 若有人改了 --layout-measure 或容器内边距，这条会失败
    expect(SIZES).toContain('704px')
    expect(SIZES).toContain('672px')
    expect(SIZES).toContain('calc(100vw - 32px)')
  })

  it('桌面内容宽等于正文测量宽度', () => {
    expect(DISPLAY_WIDTHS).toContain(672)
  })
})

describe('withBase（部署子路径）', () => {
  it('根部署原样返回', () => {
    expect(withBase('assets/media/a.webp', '/')).toBe('/assets/media/a.webp')
  })

  it('项目站点补上子路径', () => {
    expect(withBase('assets/media/a.webp', '/repo/')).toBe('/repo/assets/media/a.webp')
  })

  it('base 缺尾斜杠时自动补（CI 可能传 /repo）', () => {
    expect(withBase('assets/media/a.webp', '/repo')).toBe('/repo/assets/media/a.webp')
  })

  it('路径前多余的斜杠不会拼成双斜杠', () => {
    expect(withBase('/assets/media/a.webp', '/repo/')).toBe('/repo/assets/media/a.webp')
  })
})
