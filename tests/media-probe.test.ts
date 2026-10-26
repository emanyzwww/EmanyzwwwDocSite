import { describe, expect, it } from 'vitest'

import { readImageSize } from '../.vitepress/support/media/probe'

/**
 * 头部尺寸探测（同步、零依赖）。
 *
 * 为什么值得单独测：这是整条管线里**唯一**手工解析二进制的地方，
 * 而它一旦读错，产物会出现「渲染尺寸与实际像素不符」——图片被拉伸变形，
 * 且构建期完全不会报错。所以每个格式都用**真实最小文件头**验证。
 *
 * 各格式的期望值都对应一个已知尺寸的合成样本（见每个用例的注释）。
 */

/** 构造 PNG 头（只需要到 IHDR 的宽高）。 */
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  const view = new DataView(bytes.buffer)
  view.setUint32(8, 13) // IHDR 长度
  bytes.set([0x49, 0x48, 0x44, 0x52], 12) // 'IHDR'
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

/** 构造一张最小 JPEG 的头部（SOI + APP0 + SOF0）。 */
function jpegHeader(width: number, height: number): Uint8Array {
  const app0 = [
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01,
    0x00, 0x00,
  ]
  const sof0 = [
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
  ]
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof0, 0xff, 0xd9])
}

/** 构造有损 WebP（VP8 子格式）头。 */
function webpLossyHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30)
  bytes.set([0x52, 0x49, 0x46, 0x46], 0) // 'RIFF'
  const view = new DataView(bytes.buffer)
  view.setUint32(4, 22, true) // 文件长度占位
  bytes.set([0x57, 0x45, 0x42, 0x50], 8) // 'WEBP'
  bytes.set([0x56, 0x50, 0x38, 0x20], 12) // 'VP8 '
  view.setUint32(16, 10, true)
  bytes.set([0x9d, 0x01, 0x2a], 23) // 关键帧起始码
  view.setUint16(26, width & 0x3fff, true)
  view.setUint16(28, height & 0x3fff, true)
  return bytes
}

/** 构造无损 WebP（VP8L 子格式）头：宽高各存 14 位且都是减 1。 */
function webpLosslessHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(25)
  bytes.set([0x52, 0x49, 0x46, 0x46], 0)
  new DataView(bytes.buffer).setUint32(4, 17, true)
  bytes.set([0x57, 0x45, 0x42, 0x50], 8)
  bytes.set([0x56, 0x50, 0x38, 0x4c], 12)
  bytes.set([0x2f], 20) // VP8L 签名
  // 位布局：14 位宽-1、14 位高-1，低位在前
  const bits = (width - 1) | ((height - 1) << 14)
  bytes[21] = bits & 0xff
  bytes[22] = (bits >>> 8) & 0xff
  bytes[23] = (bits >>> 16) & 0xff
  bytes[24] = (bits >>> 24) & 0xff
  return bytes
}

/** 构造 GIF 头（逻辑屏幕描述符）。 */
function gifHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(13)
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0) // 'GIF89a'
  const view = new DataView(bytes.buffer)
  view.setUint16(6, width, true)
  view.setUint16(8, height, true)
  return bytes
}

/** 构造 SVG 文本。 */
function svgBytes(source: string): Uint8Array {
  return new TextEncoder().encode(source)
}

describe('readImageSize（PNG）', () => {
  it('从 IHDR 读出宽高', () => {
    expect(readImageSize(pngHeader(1672, 941))).toEqual({ width: 1672, height: 941 })
    expect(readImageSize(pngHeader(1, 1))).toEqual({ width: 1, height: 1 })
  })

  it('超大尺寸不溢出（32 位无符号）', () => {
    expect(readImageSize(pngHeader(100000, 50000))).toEqual({ width: 100000, height: 50000 })
  })

  it('长度不足返回 null', () => {
    expect(readImageSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull()
  })
})

describe('readImageSize（JPEG）', () => {
  it('跳过 APP0 后从 SOF0 读出宽高', () => {
    expect(readImageSize(jpegHeader(1200, 675))).toEqual({ width: 1200, height: 675 })
  })

  it('SOF 段里排除 DHT / DAC / JPG（它们不是帧头）', () => {
    // 在 SOI 之后插入一个 DHT(0xC4) 段，尺寸字段里是垃圾值
    const dht = [0xff, 0xc4, 0x00, 0x06, 0xde, 0xad, 0xbe, 0xef]
    const bytes = new Uint8Array([0xff, 0xd8, ...dht, ...jpegHeader(800, 600).subarray(2)])
    expect(readImageSize(bytes)).toEqual({ width: 800, height: 600 })
  })

  it('只有 SOI 时返回 null（不把随机字节当尺寸）', () => {
    expect(
      readImageSize(
        new Uint8Array([
          0xff, 0xd8, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x00,
        ]),
      ),
    ).toBeNull()
  })
})

describe('readImageSize（WebP）', () => {
  it('有损 VP8 读低 14 位', () => {
    expect(readImageSize(webpLossyHeader(1200, 675))).toEqual({ width: 1200, height: 675 })
  })

  it('无损 VP8L 的宽高是「存值 + 1」', () => {
    expect(readImageSize(webpLosslessHeader(1200, 675))).toEqual({ width: 1200, height: 675 })
    expect(readImageSize(webpLosslessHeader(1, 1))).toEqual({ width: 1, height: 1 })
  })

  it('子格式未知时返回 null 而不是瞎猜', () => {
    const bytes = webpLossyHeader(10, 10)
    bytes.set([0x58, 0x58, 0x58, 0x58], 12) // 'XXXX'
    expect(readImageSize(bytes)).toBeNull()
  })
})

describe('readImageSize（GIF）', () => {
  it('逻辑屏幕描述符里的宽高', () => {
    expect(readImageSize(gifHeader(640, 480))).toEqual({ width: 640, height: 480 })
  })
})

describe('readImageSize（SVG）', () => {
  it('width / height 属性优先', () => {
    expect(
      readImageSize(svgBytes('<svg width="120" height="80" viewBox="0 0 1 1"></svg>')),
    ).toEqual({
      width: 120,
      height: 80,
    })
  })

  it('允许带 px 单位', () => {
    expect(readImageSize(svgBytes('<svg width="64px" height="32px"></svg>'))).toEqual({
      width: 64,
      height: 32,
    })
  })

  it('没有 width/height 时退回 viewBox', () => {
    expect(readImageSize(svgBytes('<svg viewBox="0 0 300 150"></svg>'))).toEqual({
      width: 300,
      height: 150,
    })
  })

  it('不把 stroke-width 误当成 width', () => {
    // 回归：早期用 `\bwidth` 会命中 `stroke-width`，读出描边宽度当画布宽
    expect(readImageSize(svgBytes('<svg stroke-width="9" viewBox="0 0 200 100"></svg>'))).toEqual({
      width: 200,
      height: 100,
    })
  })

  it('XML 声明与注释在前面也能认', () => {
    const source = '<?xml version="1.0"?><!-- c --><svg width="10" height="20"></svg>'
    expect(readImageSize(svgBytes(source))).toEqual({ width: 10, height: 20 })
  })

  it('既无尺寸属性又无 viewBox 时返回 null', () => {
    expect(readImageSize(svgBytes('<svg></svg>'))).toBeNull()
  })
})

describe('readImageSize（无法识别）', () => {
  it('BMP 返回 null（管线随后给出「另存为 PNG」的报错）', () => {
    const bytes = new Uint8Array(20)
    bytes.set([0x42, 0x4d], 0) // 'BM'
    expect(readImageSize(bytes)).toBeNull()
  })

  it('太短的文件返回 null', () => {
    expect(readImageSize(new Uint8Array(4))).toBeNull()
  })
})
