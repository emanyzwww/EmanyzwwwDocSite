/**
 * 指令系统的安装入口。
 *
 * 一个函数做完两件事：把内置指令注册进表、把块级扫描规则挂到 markdown-it。
 * 页面正文与非页面渲染（bio / 侧栏卡片）都调它，因此**两边行为一致**。
 */

import { installDirectiveRule, type DirectiveMarkdownIt } from './block'
import { DIRECTIVES } from './builtins'
import { defineDirective, directiveNames } from './registry'

/**
 * 注册内置指令并安装扫描规则。
 *
 * **幂等**：同一个 `md` 实例重复调用不会重复注册（重复注册会抛错）。
 * 每个 markdown-it 实例各自安装一次扫描规则是必须的——规则表挂在实例上。
 *
 * 参数收 `unknown` 再在内部窄化：`markdown-it` 的类型有三份互不兼容的声明
 * （CJS / ESM / VitePress 内联），与 `support/markdown-plugins.ts` 顶部记录的
 * 是同一个问题。函数签名收 `unknown` 后，三份都能传进来。
 */
export function installDirectives(md: unknown): void {
  // 注册表是模块级的：第一次调用时装满，之后只装规则
  if (directiveNames().length === 0) {
    for (const directive of DIRECTIVES) defineDirective(directive)
  }

  installDirectiveRule(md as DirectiveMarkdownIt)
}

export { directiveNames, getDirective, unknownDirectiveMessage } from './registry'
export type { Directive, DirectiveArgs, DirectiveContext } from './registry'
