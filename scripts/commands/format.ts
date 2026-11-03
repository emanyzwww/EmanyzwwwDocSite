/**
 * `pnpm doc format` —— 正文 Markdown 排版。
 *
 * 只动正文：frontmatter 原样保留（值归 `doc fix` 管），代码围栏内、
 * `:::` 指令、行内代码、表格与链接语法一律不碰。
 *
 * 默认写盘；`--try` 只报告差异。TTY 裸调进入预览确认向导。
 */

import { writeFileSync } from 'node:fs'

import { hasOption } from '../lib/args'
import {
  parseCommandArgs,
  parseScope,
  printCommandHelp,
  shouldWizard,
  tagFilterOf,
  wantsCommandHelp,
  type CommandMeta,
} from '../lib/cli'
import { matchesScope, scopeSummary, type Scope } from '../lib/filters'
import { joinFrontmatter, splitFrontmatterRaw } from '../lib/frontmatter'
import { formatMarkdownBody } from '../lib/markdown-format'
import { collectPostFiles, type PostFile } from '../lib/posts'
import { askConfirm, askMultiSelect } from '../lib/prompt'
import { blank, c, info, success, warn } from '../lib/ui'

/** 帮助信息。 */
export const meta: CommandMeta = {
  name: 'format',
  summary: '排版正文（空白、标题、列表），不动 frontmatter 与代码',
  usage: 'format [参数]',
  options: [{ flag: '--try', description: '只显示会改什么，不写盘' }],
  examples: ['pnpm doc format --try', 'pnpm doc format -l=zh-cn,en', 'pnpm doc format -d=2026'],
}

/** 一份待排版的正文。 */
interface FormatPlan {
  file: string
  absolutePath: string
  /** 排版后的完整文件内容。 */
  content: string
  /** 变化行数（粗略）。 */
  changedLines: number
}

/** 计算一篇的排版计划。 */
function planFormat(post: PostFile): FormatPlan | null {
  const { header, body } = splitFrontmatterRaw(post.raw)
  const result = formatMarkdownBody(body)
  if (!result.changed) return null

  const content = joinFrontmatter(header, result.text)
  // 正文的「前导空行」由 joinFrontmatter 统一补回；拼回后与原文一致就是没变
  if (content === post.raw) return null

  return {
    file: post.path.filePath,
    absolutePath: post.path.absolutePath,
    content,
    changedLines: result.changedLines,
  }
}

/** 收集范围内的排版计划。 */
function collectPlans(scope: Scope): FormatPlan[] {
  const posts = collectPostFiles().filter((post) => matchesScope(post, scope))
  return posts.map(planFormat).filter((plan): plan is FormatPlan => plan !== null)
}

/** 应用排版并打印。 */
function applyPlans(plans: FormatPlan[]): void {
  blank()
  for (const plan of plans) {
    console.log(`${c.bold(plan.file)} ${c.dim(`（${plan.changedLines} 行变化）`)}`)
    writeFileSync(plan.absolutePath, plan.content, 'utf-8')
  }
  blank()
  success(`已格式化 ${plans.length} 个文件`)
  info(c.dim('建议接着运行 pnpm doc check 确认'))
  blank()
}

/** 命令入口。 */
export default async function main(argv: string[]): Promise<void> {
  const args = parseCommandArgs(argv, [{ name: 'try', boolean: true }])
  if (wantsCommandHelp(args)) {
    printCommandHelp(meta)
    return
  }

  const scope = parseScope(args)
  tagFilterOf(scope, 'format')
  const plans = collectPlans(scope)
  const tryRun = hasOption(args, 'try')

  blank()
  if (plans.length === 0) {
    success('无需格式化：范围内的正文都已规整')
    blank()
    return
  }

  if (tryRun) {
    warn(`--try：${plans.length} 个文件会变化，未写盘`)
    blank()
    for (const plan of plans) {
      info(`${plan.file} ${c.dim(`（约 ${plan.changedLines} 行）`)}`)
    }
    blank()
    return
  }

  if (shouldWizard(argv)) {
    await runWizard(scope, plans)
    return
  }

  info(c.dim(`范围：${scopeSummary(scope)}`))
  applyPlans(plans)
}

/** 预览并勾选要格式化的文件。 */
async function runWizard(scope: Scope, plans: FormatPlan[]): Promise<void> {
  info(c.dim(`范围：${scopeSummary(scope)}，${plans.length} 个文件会变化`))
  blank()
  for (const plan of plans) info(`  ${plan.file} ${c.dim(`（约 ${plan.changedLines} 行）`)}`)
  blank()

  const selected = await askMultiSelect(
    '选择要格式化的文件（空格勾选，回车确认）',
    plans.map((plan) => ({
      value: plan.file,
      label: `${plan.file} ${c.dim(`（约 ${plan.changedLines} 行）`)}`,
    })),
    plans.map((plan) => plan.file),
  )

  const chosen = plans.filter((plan) => selected.includes(plan.file))
  if (chosen.length === 0) {
    warn('没有选择任何文件')
    return
  }

  const confirmed = await askConfirm(`确认写入这 ${chosen.length} 个文件？`, true)
  if (!confirmed) {
    warn('已取消')
    return
  }

  applyPlans(chosen)
}

/** 供主菜单复用。 */
export async function wizard(): Promise<void> {
  const scope: Scope = { locales: undefined, date: undefined, tag: { mode: 'none' } }
  const plans = collectPlans(scope)
  blank()
  if (plans.length === 0) {
    success('无需格式化：所有正文都已规整')
    blank()
    return
  }
  await runWizard(scope, plans)
}
