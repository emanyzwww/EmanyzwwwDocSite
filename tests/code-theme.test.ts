import { describe, expect, it } from 'vitest'

import {
  CODE_BACKGROUND,
  CODE_PALETTE,
  CODE_THEME_DARK,
  CODE_THEME_LIGHT,
  CODE_THEMES,
} from '../.vitepress/support/markdown/code-theme'

/**
 * 代码块配色的两条契约：
 *
 * 1. **每个 token 颜色在自己的底色上都 ≥ 4.5:1**（WCAG AA 正文）。
 *    代码是正文内容，不是装饰；注释、字符串这些高频 token 掉到 4.5 以下，
 *    读者就会开始眯眼——旧主题（`github-dark` 的注释色 3.96:1）就是因此被换掉的。
 * 2. **明暗两套主题结构完整**：Shiki 需要 `settings` 数组与 `editor.foreground`
 *    形式的 colors（写 `foreground` 会被静默忽略并退回 VS Code 兜底色）。
 */

/** WCAG 2.x 相对亮度。 */
function luminance(hex: string): number {
  const value = hex.replace('#', '')
  const channels = [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16) / 255)

  return channels.reduce((sum, channel, index) => {
    const linear = channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    return sum + linear * [0.2126, 0.7152, 0.0722][index]
  }, 0)
}

/** 两色对比度（前景 / 背景，顺序无关）。 */
function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].toSorted((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

describe('代码块双主题：对比度', () => {
  for (const mode of ['light', 'dark'] as const) {
    const palette = CODE_PALETTE[mode]
    const background = CODE_BACKGROUND[mode]

    describe(mode, () => {
      for (const [role, color] of Object.entries(palette)) {
        it(`${role} 在自己的底色上 ≥ 4.5:1`, () => {
          expect(contrast(color, background)).toBeGreaterThanOrEqual(4.5)
        })
      }
    })
  }

  it('浅色主题的底色比深色主题亮（两套确实是两个方向）', () => {
    expect(luminance(CODE_BACKGROUND.light)).toBeGreaterThan(luminance(CODE_BACKGROUND.dark))
  })
})

describe('代码块双主题：结构', () => {
  it('两套主题的 name / type 不重复且方向正确', () => {
    expect(CODE_THEME_LIGHT.name).toBe('jade-light')
    expect(CODE_THEME_LIGHT.type).toBe('light')
    expect(CODE_THEME_DARK.name).toBe('jade-dark')
    expect(CODE_THEME_DARK.type).toBe('dark')
    expect(CODE_THEMES.light).toBe(CODE_THEME_LIGHT)
    expect(CODE_THEMES.dark).toBe(CODE_THEME_DARK)
  })

  for (const theme of [CODE_THEME_LIGHT, CODE_THEME_DARK]) {
    describe(theme.name, () => {
      it('用 editor.background / editor.foreground 而不是 foreground/background', () => {
        expect(theme.colors['editor.background']).toBe(CODE_BACKGROUND[theme.type])
        expect(theme.colors['editor.foreground']).toBe(CODE_PALETTE[theme.type].base)
        expect(theme.colors).not.toHaveProperty('foreground')
        expect(theme.colors).not.toHaveProperty('background')
      })

      it('每条 settings 都有非空 scope 与合法色值', () => {
        expect(theme.settings.length).toBeGreaterThan(0)
        for (const setting of theme.settings) {
          expect(setting.scope.length).toBeGreaterThan(0)
          expect(setting.settings.foreground).toMatch(/^#[0-9a-f]{6}$/i)
        }
      })

      it('所有 token 色都来自该主题的色板（没有漏改的旧色）', () => {
        const palette = new Set(Object.values(CODE_PALETTE[theme.type]).map((color) => color.toLowerCase()))
        for (const setting of theme.settings) {
          expect(palette.has(setting.settings.foreground.toLowerCase())).toBe(true)
        }
      })

      it('覆盖关键字 / 字符串 / 注释 / 数字 / 函数 / 标签这六类高频 token', () => {
        const scopes = new Set(theme.settings.flatMap((setting) => setting.scope))
        for (const scope of [
          'keyword',
          'string',
          'comment',
          'constant.numeric',
          'entity.name.function',
          'entity.name.tag',
        ]) {
          expect(scopes.has(scope)).toBe(true)
        }
      })
    })
  }

  it('注释与字符串没有斜体（中文没有真正的斜体，合成斜体会发虚）', () => {
    for (const theme of [CODE_THEME_LIGHT, CODE_THEME_DARK]) {
      for (const setting of theme.settings) {
        expect(setting.settings).not.toHaveProperty('fontStyle')
      }
    }
  })
})
