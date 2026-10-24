/**
 * 命令行入口（唯一）。
 *
 * 所有命令都从这一个文件进来：`pnpm new` / `pnpm posts` / `pnpm check` …
 * 在 `package.json` 里都指向 `tsx scripts/run.ts <命令>`。
 *
 * 为什么不做成「每个命令一个可执行文件」：
 * 1. 参数解析、错误处理、颜色开关、站点路径等逻辑每个命令都要用一份，
 *    分散成 8 个入口就是 8 份 `try/catch` 与 8 份 `process.exit`；
 * 2. 共用内核（`.vitepress/data/frontmatter.ts`、`scripts/lib/*`）需要一个
 *    稳定位置做「加载 → 校验 → 执行」的夹层，单入口天然提供这个位置。
 *
 * 用 `tsx` 执行而不是 `node --experimental-strip-types`：
 * 后者的类型擦除不处理 `enum`、装饰器与路径别名，而且 Node 20（
 * `package.json` 声明的 engines 下限）完全不支持。tsx 是唯一额外依赖，
 * 换来的是「脚本里写的就是构建期同一套 TS」。
 */

import { existsSync } from 'node:fs'

/** 命令名 → 模块文件。新增命令只需要在这里加一行。 */
const COMMANDS = {
  new: 'new.ts',
  posts: 'posts.ts',
  check: 'check.ts',
  fix: 'fix.ts',
  stats: 'stats.ts',
  tags: 'tags.ts',
  clean: 'clean.ts',
} as const

type CommandName = keyof typeof COMMANDS

/** 判断是否是已知命令。 */
function isCommandName(value: string): value is CommandName {
  return Object.hasOwn(COMMANDS, value)
}

/** 打印总帮助。 */
function printHelp(): void {
  const lines = [
    '',
    'EmanyzwwwDocSite 内容脚本',
    '',
    '用法  pnpm <命令> [参数]',
    '',
    '命令',
    '  new [选项]              新建一篇文章（按北京时间自动分配日期与当日序号）',
    '  posts [YYYYMMDD]        列出文章（不给日期则列全部）',
    '  check [选项]            检查内容与 frontmatter，报告不合规之处',
    '  fix [选项]              自动修复 check 能修的项（排序、补字段、规范化日期）',
    '  stats [选项]            统计文章数、字数、标签分布',
    '  tags [选项]             列出标签及其文章数',
    '  clean                   清理构建产物与缓存',
    '',
    '通用选项',
    '  -l, --lang <zh-cn|en>   语言，默认 zh-cn',
    '  -h, --help              查看该命令的详细帮助',
    '',
    '示例',
    '  pnpm new -l=zh-cn --title="我的新文章" --tags=随笔,工具',
    '  pnpm posts 20261024',
    '  pnpm posts -l=en --tags=Essay --json',
    '  pnpm check --all',
    '  pnpm fix --dry-run',
    '',
    '注意  `pnpm list` 与 `pnpm help` 都是 pnpm 内置命令，会被它自己截获；',
    '      查看本帮助请用 `pnpm guide`，列出文章请用 `pnpm posts`。',
    '',
  ]
  console.log(lines.join('\n'))
}

/** 主流程。 */
async function main(argv: string[]): Promise<void> {
  const [rawCommand, ...rest] = argv

  // 无参数 / 帮助：打印总览
  if (
    rawCommand === undefined ||
    rawCommand === '--help' ||
    rawCommand === '-h' ||
    rawCommand === 'help'
  ) {
    printHelp()
    return
  }

  if (!isCommandName(rawCommand)) {
    console.error(`✗ 未知命令：${rawCommand}`)
    console.error('')
    printHelp()
    process.exitCode = 1
    return
  }

  const modulePath = new URL(COMMANDS[rawCommand], import.meta.url)
  if (!existsSync(modulePath)) {
    console.error(`✗ 命令脚本缺失：scripts/${COMMANDS[rawCommand]}`)
    process.exitCode = 1
    return
  }

  const module = (await import(modulePath.href)) as {
    default: (args: string[]) => Promise<void> | void
  }
  await module.default(rest)
}

/*
 * 统一错误出口：业务代码只管 `throw new Error('人话')`，
 * 这里负责打印成一行 `✗ 原因` 并给出非零退出码。
 * 不打印堆栈——这些错误几乎都是「参数写错了 / 文件已存在」，
 * 堆栈只会淹没真正有用的那句话。设 `DEBUG=1` 时才输出完整堆栈。
 */
main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`✗ ${message}`)
  if (process.env.DEBUG === '1' && error instanceof Error) {
    console.error(error.stack)
  }
  process.exitCode = 1
})
