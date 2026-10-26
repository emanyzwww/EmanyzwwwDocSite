/**
 * 图标表入口（兼容层）。
 *
 * 真正的实现搬到了 `shared/icons.ts` —— 因为块级指令需要在**构建期**
 * 把图标拼成内联 SVG 字符串，而构建期代码不能 import `theme/`。
 *
 * 这里只做转出，让 `theme/` 内部既有的 `import { getIcon } from '../../support/icons'`
 * 继续可用。新增代码请直接 import `shared/icons`。
 */

export { getIcon, ICONS, STROKE_WIDTH, renderIcon } from '../../shared/icons'
export type { IconDef } from '../../shared/icons'
