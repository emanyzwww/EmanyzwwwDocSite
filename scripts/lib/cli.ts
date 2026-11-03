/**
 * 命令行公共层：全局参数、命令元信息、交互判定、帮助渲染。
 *
 * 约定：
 * - 每个子命令是 `scripts/commands/<name>.ts`，导出 `meta` 与 `main(argv)`；
 * - `meta` 同时用于 `doc help`，帮助文本不需要另写一份；
 * - 全局参数（`-l/-d/-t`）由 `parseScope()` 统一解析，各命令不再各写一遍。
 */

import { readFileSync } from 'node:fs'

import type { LocaleCode } from '../../.vitepress/types'
import { hasOption, optionValue, parseArgs, type CliArgs, type OptionSpec } from './args'
import {
  parseDateFilter,
  parseTagList,
  type Scope,
  type TagFilter,
  type TagOption,
} from './filters'
import { LOCALE_CODES } from './site'
import { c, helpLines, padEnd } from './ui'

/** 全局选项：所有内容命令都认识。 */
export const COMMON_OPTIONS: readonly OptionSpec[] = [
  { name: 'lang', short: 'l' },
  { name: 'date', short: 'd' },
  { name: 'tag', short: 't', optionalValue: true },
  { name: 'help', short: 'h', boolean: true },
]

/** 全局选项在帮助里的说明。 */
const COMMON_HELP = [
  {
    flag: '-l, --lang <codes>',
    description: '语言：zh-cn、en 或 zh-cn,en（严格匹配；默认全部）',
  },
  {
    flag: '-d, --date <spec>',
    description: '日期：2026 / 202611 / 20261101 / 202601..202606（默认全部）',
  },
  {
    flag: '-t, --tag <tags>',
    description: '标签：new 为赋值，其余为过滤；list 裸用 -t 看标签视图',
  },
  { flag: '-h, --help', description: '显示本帮助' },
] as const

/** 一个命令的帮助信息。 */
export interface CommandMeta {
  /** 子命令名，如 `new`。 */
  name: string
  /** 一句话说明。 */
  summary: string
  /** 用法行（不含 `pnpm doc` 前缀）。 */
  usage: string
  /** 命令的选项（全局选项会自动拼上）。 */
  options: readonly { flag: string; description: string }[]
  /** 是否不显示全局选项（如 `clean` 不接受 `-l/-d/-t`）。 */
  omitCommon?: boolean
  /** 示例。 */
  examples?: readonly string[]
}

/** 命令模块的形状。 */
export interface CommandModule {
  meta: CommandMeta
  main: (argv: string[]) => Promise<void>
  /**
   * 交互模式入口（由主菜单调用）。
   *
   * 只有 `new / list / check / fix / format / clean` 需要它；`main([])` 在
   * TTY 下也会走到同一套向导，这里单独暴露是为了让菜单能直接复用。
   */
  wizard?: () => Promise<void>
}

/**
 * 是否是交互环境。
 *
 * 除了 TTY，还要排除 CI：CI 里没有 stdin，clack 的提示会直接卡死。
 */
export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY) && !process.env.CI
}

/**
 * 是否需要进交互向导。
 *
 * 规则：**没有额外参数**且是 TTY；`list` / `check` 不走向导（裸调直接执行），
 * 由主菜单提供交互式筛选。
 */
export function shouldWizard(argv: string[]): boolean {
  return isInteractive() && argv.length === 0
}

/** 解析全局范围参数。 */
export function parseScope(args: CliArgs): Scope {
  const localeValue = optionValue(args, 'lang')
  const locales = localeValue === undefined ? undefined : parseLang(localeValue)
  const date = parseDateFilter(optionValue(args, 'date'))

  const rawTag = args.options.get('tag')
  let tag: TagOption = { mode: 'none' }
  if (rawTag === true) {
    tag = { mode: 'bare' }
  } else if (typeof rawTag === 'string') {
    tag = { mode: 'some', tags: parseTagList(rawTag) }
  }

  return { locales, date, tag }
}

/**
 * 解析 `-l`：只接受站点里真实存在的语言代码，严格匹配、区分大小写。
 *
 * 刻意不做 `zh` / `cn` / `en-us` 之类的别名：写错就直接报错，
 * 避免静默落到默认语言、把文章建到错误目录里。
 */
export function parseLang(value: string): LocaleCode[] {
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')

  if (parts.length === 0) {
    throw new Error(`--lang 需要值：${LOCALE_CODES.join('、')}，或逗号分隔`)
  }

  for (const part of parts) {
    if (!(LOCALE_CODES as readonly string[]).includes(part)) {
      throw new Error(`不支持的语言：${part}（只接受 ${LOCALE_CODES.join('、')}，区分大小写）`)
    }
  }

  // 按站点定义顺序返回，保证输出稳定
  return LOCALE_CODES.filter((code) => parts.includes(code))
}

/**
 * 取标签过滤条件。
 *
 * `-t` 裸用只在 `list` 里有意义（标签视图）；其余命令必须给值。
 */
export function tagFilterOf(scope: Scope, command: string): TagFilter | undefined {
  if (scope.tag.mode === 'bare') {
    throw new Error(`${command} 的 -t/--tag 需要值，例如 -t=随笔`)
  }
  return scope.tag.mode === 'some' ? { tags: scope.tag.tags } : undefined
}

/** 解析参数（自动带上全局选项）。 */
export function parseCommandArgs(argv: string[], specs: readonly OptionSpec[]): CliArgs {
  return parseArgs(argv, [...COMMON_OPTIONS, ...specs])
}

/** 是否请求了帮助。 */
export function wantsCommandHelp(args: CliArgs): boolean {
  return hasOption(args, 'help')
}

/** 打印单个命令的详细帮助。 */
export function printCommandHelp(meta: CommandMeta): void {
  helpLines(
    `pnpm doc ${meta.name}`,
    `pnpm doc ${meta.usage}`,
    [...(meta.omitCommon === true ? [] : COMMON_HELP), ...meta.options],
    meta.examples ?? [],
  )
}

/** 读 `package.json` 的版本号。 */
export function packageVersion(): string {
  const raw = readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')
  const data = JSON.parse(raw) as { version?: string }
  return data.version ?? '0.0.0'
}

/**
 * 打印总帮助。
 *
 * 不引第三方 CLI 框架，所以表格自己画：中文宽度由 `ui.ts` 的 `padEnd()`
 * 按显示宽度补齐，中英混排也不会歪。
 */
export function printOverview(commands: readonly CommandMeta[]): void {
  console.log('')
  console.log(`${c.bold('EmanyzwwwDocSite')} ${c.dim('· 内容工作台')}`)
  console.log('')
  console.log(`${c.dim('用法')}  pnpm doc [命令] [参数]`)
  console.log('')
  console.log(c.dim('命令'))

  const rows = [
    ...commands.map((meta) => ({ usage: `doc ${meta.usage}`, summary: meta.summary })),
    { usage: 'doc', summary: '打开交互菜单' },
    { usage: 'doc help [命令]', summary: '命令总览 / 单命令帮助' },
  ]
  const usageWidth = Math.max(...rows.map((row) => row.usage.length), 0)
  for (const row of rows) {
    console.log(`  ${c.cyan(padEnd(row.usage, usageWidth))}  ${row.summary}`)
  }
  console.log('')
  console.log(c.dim('全局参数'))
  for (const item of COMMON_HELP) {
    console.log(`  ${item.flag.padEnd(24)}${item.description}`)
  }
  console.log('')
  console.log(c.dim('日期写法'))
  console.log('  2026             2026 全年')
  console.log('  202611           2026 年 11 月')
  console.log('  20261101         2026-11-01 当天')
  console.log('  2026110101       11-01 第 01 篇')
  console.log('  202601..202606   闭区间')
  console.log('  202601,202603    并集')
  console.log('')
  console.log(c.dim('示例'))
  console.log('  pnpm doc new "你好，世界" -l=zh-cn -t=随笔')
  console.log('  pnpm doc list -d=2026 -t=随笔')
  console.log('  pnpm doc list -t')
  console.log('  pnpm doc check -l=zh-cn,en')
  console.log('  pnpm doc fix --try')
  console.log('  pnpm doc format -d=2026')
  console.log('  pnpm doc clean --try')
  console.log('')
}
