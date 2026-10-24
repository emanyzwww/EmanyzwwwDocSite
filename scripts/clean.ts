/**
 * `pnpm clean` —— 清理构建产物与缓存。
 *
 * 原来这一行塞在 `package.json` 里，写法是 `node -e "...require('fs')..."`：
 * 在 ESM 包（`"type": "module"`）里靠 `require` 是历史遗留写法，
 * 且反斜杠转义让它极难读、无法加注释。挪成脚本后与其它命令同构。
 */

import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { parseArgs, wantsHelp } from './lib/args'
import { REPO_ROOT } from './lib/site'
import { blank, c, helpLines, info, success } from './lib/ui'

/** 需要清理的目录（相对仓库根）。 */
const TARGETS = [
  { path: '.vitepress/dist', label: '构建产物' },
  { path: '.vitepress/cache', label: '构建缓存' },
  { path: '.vitepress/.temp', label: '临时文件' },
  { path: 'node_modules/.vite', label: 'Vite 依赖预构建缓存' },
  { path: 'node_modules/.vitest-cache', label: '测试缓存' },
] as const

/** 选项。 */
const SPECS = [{ name: 'help', short: 'h', boolean: true }] as const

/** 命令主体。 */
export default function main(argv: string[]): void {
  const args = parseArgs(argv, [...SPECS])
  if (wantsHelp(args)) {
    helpLines('pnpm clean', 'pnpm clean', [{ flag: '-h, --help', description: '显示本帮助' }])
    return
  }

  blank()

  let removed = 0
  for (const target of TARGETS) {
    const absolute = join(REPO_ROOT, target.path)
    if (!existsSync(absolute)) {
      info(`${c.dim('跳过')}  ${target.path} ${c.dim('（不存在）')}`)
      continue
    }

    rmSync(absolute, { recursive: true, force: true })
    success(`删除 ${target.path} ${c.dim(`（${target.label}）`)}`)
    removed += 1
  }

  blank()
  if (removed === 0) {
    info('没有需要清理的内容')
  } else {
    info(c.dim(`共清理 ${removed} 项`))
  }
  blank()
}
