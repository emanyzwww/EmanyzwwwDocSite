/**
 * `pnpm doc clean` —— 清理构建产物与缓存。
 *
 * 目标固定为 `.vitepress/dist`、`.vitepress/cache`、`.vitepress/.temp` 与
 * `node_modules/.vite`。TTY 裸调先显示占用再确认；其它情况（或 `--try`）只报告。
 */

import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { hasOption } from '../lib/args'
import {
  parseCommandArgs,
  printCommandHelp,
  shouldWizard,
  wantsCommandHelp,
  type CommandMeta,
} from '../lib/cli'
import { askConfirm, p } from '../lib/prompt'
import { REPO_ROOT } from '../lib/site'
import { blank, c, info, success, warn } from '../lib/ui'

/** 需要清理的目录（相对仓库根）。 */
const TARGETS = [
  { path: '.vitepress/dist', label: '构建产物' },
  { path: '.vitepress/cache', label: '构建缓存' },
  { path: '.vitepress/.temp', label: '临时文件' },
  { path: 'node_modules/.vite', label: 'Vite 预构建缓存' },
] as const

/** 帮助信息。 */
export const meta: CommandMeta = {
  name: 'clean',
  summary: '清理构建产物与缓存',
  usage: 'clean [参数]',
  options: [
    { flag: '--try', description: '只显示会删除什么，不删' },
    { flag: '-h, --help', description: '显示本帮助' },
  ],
  omitCommon: true,
  examples: ['pnpm doc clean --try', 'pnpm doc clean'],
}

/** 递归统计目录大小（字节）。 */
function directorySize(path: string): number {
  let total = 0
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name)
    if (entry.isDirectory()) total += directorySize(full)
    else if (entry.isFile()) total += statSync(full).size
  }
  return total
}

/** 人类可读的字节数。 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/** 一个待清理目标的现状。 */
interface CleanTarget {
  path: string
  label: string
  size: number
}

/** 扫描目标。 */
function scanTargets(): CleanTarget[] {
  const found: CleanTarget[] = []
  for (const target of TARGETS) {
    const absolute = join(REPO_ROOT, target.path)
    if (!existsSync(absolute)) continue
    found.push({ path: target.path, label: target.label, size: directorySize(absolute) })
  }
  return found
}

/** 删除目标。 */
function removeTargets(targets: CleanTarget[]): void {
  for (const target of targets) {
    rmSync(join(REPO_ROOT, target.path), { recursive: true, force: true })
    success(`删除 ${target.path} ${c.dim(`（${target.label}，${formatBytes(target.size)}）`)}`)
  }
}

/** 命令入口。 */
export default async function main(argv: string[]): Promise<void> {
  const args = parseCommandArgs(argv, [{ name: 'try', boolean: true }])
  if (wantsCommandHelp(args)) {
    printCommandHelp(meta)
    return
  }

  if (args.options.has('lang') || args.options.has('date') || args.options.has('tag')) {
    throw new Error('clean 不支持 -l/-d/-t：它只清理构建产物与缓存')
  }

  const targets = scanTargets()
  blank()

  if (targets.length === 0) {
    info('没有需要清理的内容')
    blank()
    return
  }

  for (const target of targets) {
    info(
      `${c.dim('待清理')}  ${target.path} ${c.dim(`（${target.label}，${formatBytes(target.size)}）`)}`,
    )
  }
  blank()

  if (hasOption(args, 'try')) {
    warn('--try：以上内容未删除')
    blank()
    return
  }

  // TTY 裸调：先确认；带参数或非 TTY：直接清理
  if (shouldWizard(argv)) {
    const confirmed = await askConfirm(`确认删除以上 ${targets.length} 项？`, true)
    if (!confirmed) {
      p.cancel('已取消')
      return
    }
  }

  removeTargets(targets)
  blank()
  info(c.dim(`共清理 ${targets.length} 项`))
  blank()
}

/** 供主菜单复用。 */
export async function wizard(): Promise<void> {
  await main([])
}
