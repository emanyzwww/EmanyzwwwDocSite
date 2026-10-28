/**
 * 本站代码块（Shiki）配色：**明暗两套自有主题**。
 *
 * ## 为什么不用现成主题
 *
 * 1. 现成主题（`github-*`、`vitesse-*`）的色板与本系统的 jade + 暖灰完全无关，
 *    代码块会成为页面上唯一一块「别人的界面」；
 * 2. 它们的对比度不为我们负责：`github-dark` 的注释色在深底上只有 3.96:1，
 *    低于 AA 的 4.5:1（旧版本就是因此换成 `github-dark-default` 的）；
 * 3. 本站是**明暗双主题站点**，代码块也跟着明暗走。双主题要求每个 token 颜色
 *    在**两种底色上**分别达标，现成主题没有一组能同时满足我们的底色。
 *
 * ## 设计约束（与 DESIGN.md 一致）
 *
 * | 约束 | 落点 |
 * | ---- | ---- |
 * | 全站只有一个强调色（jade） | 关键字 / 标签用 jade，其余色相都压到低饱和 |
 * | 颜色必须有语义分工，不做彩虹 | 只保留 4 个色相 + 3 级中性 |
 * | 每个 token 颜色在代码底色上都 ≥ 4.5:1 | `tests/code-theme.test.ts` 逐条复算 |
 * | 注释与字符串**不用斜体** | 中文没有真正的斜体，合成斜体会「发虚」 |
 *
 * ## 色相分工
 *
 * ```text
 * 底色（浅）  #f4f5f3   ← 与 --bg-code 浅色一致（tokens.css）
 * 底色（深）  #0a0d0c   ← 与 --bg-code 深色一致
 *
 * 角色      浅色       深色       语义
 * base      #161c1a    #dfe5e2   正文标识符、运算符、对象键
 * comment   #5c6663    #7d8783   注释、文档字符串
 * keyword   #0f766e    #4acdb4   关键字、存储类型、预处理指令（jade = 本站强调色）
 * string    #7a5f14    #d8b06a   字符串、正则、转义、markup 原始片段
 * value     #8a3f63    #e0a4c4   数字、布尔、常量、`this`/`self`、属性名
 * call      #1f6f8b    #7cc7e6   函数名、方法、类型、类
 * tag       #0f766e    #4acdb4   HTML 标签（与关键字同色：语义上都是「结构标记」）
 * punct     #3f4946    #a3adaa   括号、分隔符、大部分运算符
 * invalid   #a12a20    #ff8a80   语法错误（只在 diff / 错误片段里出现）
 * ```
 *
 * 为什么是这 4 个色相：jade（结构）、琥珀（字面量）、梅紫（值）、青蓝（名字）。
 * 两两之间色相差 ≥ 40°，缩到 12px 等宽字也能分辨；同时又都掺了灰，
 * 不会像高饱和主题那样抢正文的注意力。
 *
 * ## 单一事实来源
 *
 * 这个文件是代码块**配色**的唯一来源；`tokens.css` 只负责**底色与控件色**
 * （`--bg-code` / `--bg-code-head` / 代码块头部的文字与按钮色）。
 * 改配色 → 改这里 + `tokens.css` 的底色，然后按 DESIGN.md §9.1 复算对比度。
 */

/** 颜色角色。`base` 不在 settings 里出现，它是主题的 `foreground`。 */
export type CodeColorRole =
  | 'base'
  | 'comment'
  | 'keyword'
  | 'string'
  | 'value'
  | 'call'
  | 'tag'
  | 'attribute'
  | 'punctuation'
  | 'invalid'

/** 代码块底色：与 `tokens.css` 的 `--bg-code` 必须一致（明暗各一条）。 */
export const CODE_BACKGROUND = {
  light: '#f4f5f3',
  dark: '#0a0d0c',
} as const

/**
 * 两套色板。
 *
 * 每条都在 `tests/code-theme.test.ts` 里按 WCAG 2.x 公式对着**自己的底色**复算，
 * 低于 4.5:1 会让测试失败——改色时先改测试里的期望值再改这里，别只改这里。
 */
export const CODE_PALETTE = {
  light: {
    base: '#161c1a',
    comment: '#5c6663',
    keyword: '#0f766e',
    string: '#7a5f14',
    value: '#8a3f63',
    call: '#1f6f8b',
    tag: '#0f766e',
    attribute: '#8a3f63',
    punctuation: '#3f4946',
    invalid: '#a12a20',
  },
  dark: {
    base: '#dfe5e2',
    comment: '#7d8783',
    keyword: '#4acdb4',
    string: '#d8b06a',
    value: '#e0a4c4',
    call: '#7cc7e6',
    tag: '#4acdb4',
    attribute: '#e0a4c4',
    punctuation: '#a3adaa',
    invalid: '#ff8a80',
  },
} as const satisfies Record<'light' | 'dark', Record<CodeColorRole, string>>

/**
 * 角色 → TextMate scope。
 *
 * Shiki（VS Code TextMate）的匹配规则是**更具体的 scope 胜出**，
 * 与书写顺序无关。因此这里可以放心地先写一条宽的 `keyword`、
 * 再用 `keyword.operator` 把运算符压回正文色（2 段 > 1 段），
 * 最后用 `keyword.operator.new` 之类的 3 段 scope 把「像关键字的运算符」提回 jade。
 */
const ROLE_SCOPES: Record<Exclude<CodeColorRole, 'base' | 'tag' | 'attribute'>, string[]> = {
  comment: ['comment', 'punctuation.definition.comment', 'string.comment'],
  keyword: [
    'keyword',
    'keyword.control',
    'keyword.other',
    'storage',
    'storage.type',
    'storage.modifier',
    'meta.preprocessor',
    'keyword.directive',
    // 2 段：普通运算符压回正文色（否则 `=`、`+`、`=>` 全是 jade，整段代码会「发绿」）
    'keyword.operator',
    // 3 段：这些是「长得像运算符的关键字」，必须重新提回 jade
    'keyword.operator.new',
    'keyword.operator.expression',
    'keyword.operator.typeof',
    'keyword.operator.instanceof',
    'keyword.operator.delete',
    'keyword.operator.void',
    'keyword.operator.await',
    'keyword.operator.yield',
    'keyword.operator.in',
    'keyword.operator.of',
  ],
  string: [
    'string',
    'string.quoted',
    'string.template',
    'string.interpolated',
    'string.regexp',
    'string.escape',
    'constant.character.escape',
    'punctuation.definition.string',
    'markup.raw.inline',
  ],
  value: [
    'constant.numeric',
    'constant.language',
    'constant.character',
    'constant.other',
    'support.constant',
    'support.constant.property-value',
    'variable.language',
    'variable.other.constant',
  ],
  call: [
    'entity.name.function',
    'entity.name.function.member',
    'entity.name.function.decorator',
    'support.function',
    'support.function.builtin',
    'meta.function-call',
    'entity.name.type',
    'entity.name.class',
    'entity.name.namespace',
    'entity.other.inherited-class',
    'support.type',
    'support.class',
  ],
  punctuation: ['punctuation', 'meta.brace', 'punctuation.separator', 'punctuation.terminator'],
  invalid: ['invalid', 'invalid.illegal', 'message.error'],
}

/** 单条 tokenColor。 */
export interface CodeThemeSetting {
  name: string
  scope: string[]
  settings: { foreground: string }
}

/** Shiki 主题注册对象（结构化类型，不 import Shiki 的类型包）。 */
export interface CodeTheme {
  name: string
  displayName: string
  type: 'light' | 'dark'
  colors: Record<string, string>
  settings: CodeThemeSetting[]
}

/** 由「角色 → 色值」拼出一个 Shiki 主题。 */
function createTheme(
  name: string,
  displayName: string,
  type: 'light' | 'dark',
  palette: Record<CodeColorRole, string>,
): CodeTheme {
  const settings: CodeThemeSetting[] = []

  for (const [role, scopes] of Object.entries(ROLE_SCOPES)) {
    settings.push({
      name: role,
      scope: scopes,
      settings: { foreground: palette[role as keyof typeof ROLE_SCOPES] },
    })
  }

  // 标签与属性名各自一组：与关键字 / 值同色，但语义独立，
  // 将来想让 HTML 标签换色时只动这里，不用在 scope 表里翻。
  settings.push({
    name: 'tag',
    scope: ['entity.name.tag', 'punctuation.definition.tag', 'meta.tag'],
    settings: { foreground: palette.tag },
  })
  settings.push({
    name: 'attribute',
    scope: ['entity.other.attribute-name', 'support.type.property-name'],
    settings: { foreground: palette.attribute },
  })

  return {
    name,
    displayName,
    type,
    /*
     * 默认前景/背景必须写成 `editor.foreground` / `editor.background`。
     *
     * Shiki 的 `normalizeTheme()` 只认这两个键（或 `settings` 里一条无 scope 的
     * 全局设置）；写 `foreground` / `background` 会被忽略，然后**静默退回**
     * VS Code 的兜底色 —— 浅色 #333333、深色 #BBBBBB。
     * 表现是「大部分 token 有我们的颜色，但标识符是灰色的」，很难一眼看出原因。
     */
    colors: {
      'editor.background': CODE_BACKGROUND[type],
      'editor.foreground': palette.base,
    },
    settings,
  }
}

/** 浅色主题：代码块跟着页面走浅底（`vitePress` 的 `.dark` 切换时换成下面那套）。 */
export const CODE_THEME_LIGHT = createTheme('jade-light', 'Jade Light', 'light', CODE_PALETTE.light)

/** 深色主题：与 `--bg-code` 深色底配套，注释色等全部重新算过对比度。 */
export const CODE_THEME_DARK = createTheme('jade-dark', 'Jade Dark', 'dark', CODE_PALETTE.dark)

/** 给 `config.ts` 用的双主题对象（Shiki 的 `themes: { light, dark }` 形态）。 */
export const CODE_THEMES = {
  light: CODE_THEME_LIGHT,
  dark: CODE_THEME_DARK,
} as const
