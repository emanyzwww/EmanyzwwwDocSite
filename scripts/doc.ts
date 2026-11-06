/**
 * `pnpm doc` —— 内容命令的唯一入口。
 *
 * - 不带参数：TTY 下打开交互菜单；非 TTY 打印总帮助；
 * - `pnpm doc help [命令]`：总览 / 单命令帮助；
 * - `pnpm doc <命令> [参数]`：交给对应命令；有没有参数决定交互与否
 *   （`new/fix/format/clean` 裸调走向导，`list/check` 裸调直接执行）。
 *
 * 每个命令模块导出 `meta`（帮助信息）与 `main(argv)`，另可选 `wizard()`
 * 供主菜单复用。新增命令只需要在这里的 `COMMANDS` 里加一行。
 */

import checkMain, { interactive as checkInteractive, meta as checkMeta } from './commands/check'
import cleanMain, { meta as cleanMeta, wizard as cleanWizard } from './commands/clean'
import fixMain, { meta as fixMeta, wizard as fixWizard } from './commands/fix'
import formatMain, { meta as formatMeta, wizard as formatWizard } from './commands/format'
import listMain, { meta as listMeta, wizard as listWizard } from './commands/list'
import newMain, { meta as newMeta, wizard as newWizard } from './commands/new'
import {
  isInteractive,
  packageVersion,
  printCommandHelp,
  printOverview,
  type CommandModule,
} from './lib/cli'
import { askConfirm, askSelect, intro, outro, p } from './lib/prompt'
import { blank, c } from './lib/ui'

/** 全部内容命令。顺序即帮助里的顺序。 */
const COMMANDS: readonly CommandModule[] = [
  { meta: newMeta, main: newMain, wizard: newWizard },
  { meta: listMeta, main: listMain, wizard: listWizard },
  { meta: checkMeta, main: checkMain },
  { meta: fixMeta, main: fixMain, wizard: fixWizard },
  { meta: formatMeta, main: formatMain, wizard: formatWizard },
  { meta: cleanMeta, main: cleanMain, wizard: cleanWizard },
]

/** 按名字索引。 */
const BY_NAME = new Map(COMMANDS.map((command) => [command.meta.name, command]))

/**
 * 裸调（不带参数）时本应进向导的命令。
 *
 * 非 TTY（CI、管道、重定向）里没有向导可走，若继续按默认值执行就会
 * 「空标题建全部语言」「不确认就写盘 / 删产物」；因此统一改为打印帮助。
 */
const BARE_WIZARD_COMMANDS: ReadonlySet<string> = new Set(['new', 'fix', 'format', 'clean'])

/** 主菜单项。 */
type MenuAction = 'new' | 'list' | 'check' | 'fix' | 'format' | 'clean' | 'help' | 'exit'

/** 交互主菜单。 */
async function menu(): Promise<void> {
  intro('Emanyzwww DocSite · 内容工作台')
  blank()

  while (true) {
    // 交互提示必须一次只问一个，不能并行
    // oxlint-disable-next-line no-await-in-loop
    const action = await askSelect<MenuAction>(
      '今天想做什么？',
      [
        { value: 'new', label: '新建文章' },
        { value: 'list', label: '查看 / 筛选文章' },
        { value: 'check', label: '检查内容' },
        { value: 'fix', label: '修复元字段' },
        { value: 'format', label: '格式化正文' },
        { value: 'clean', label: '清理构建产物' },
        { value: 'help', label: '帮助' },
        { value: 'exit', label: '退出' },
      ],
      'new',
    )

    if (action === 'exit') break
    try {
      // oxlint-disable-next-line no-await-in-loop
      await runAction(action)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      p.log.error(message)
    }

    // oxlint-disable-next-line no-await-in-loop
    const again = await askConfirm('回到菜单继续？', true)
    if (!again) break
    blank()
  }

  outro('再见')
}

/** 执行菜单里选中的动作。 */
async function runAction(action: MenuAction): Promise<void> {
  switch (action) {
    case 'new':
      await newWizard()
      return
    case 'list':
      await listWizard()
      return
    case 'check':
      await checkInteractive()
      return
    case 'fix':
      await fixWizard()
      return
    case 'format':
      await formatWizard()
      return
    case 'clean':
      await cleanWizard()
      return
    case 'help':
      printOverview(COMMANDS.map((command) => command.meta))
      return
    case 'exit':
      return
  }
}

/** 主流程。 */
async function main(argv: string[]): Promise<void> {
  const [first, ...rest] = argv

  if (first === undefined) {
    if (isInteractive()) {
      await menu()
      return
    }
    printOverview(COMMANDS.map((command) => command.meta))
    return
  }

  if (first === 'help' || first === '--help' || first === '-h') {
    const name = rest[0]
    if (name === undefined) {
      printOverview(COMMANDS.map((command) => command.meta))
      return
    }
    const command = BY_NAME.get(name)
    if (!command) throw new Error(`未知命令：${name}（可选：${[...BY_NAME.keys()].join('、')}）`)
    printCommandHelp(command.meta)
    return
  }

  if (first === '-v' || first === '--version') {
    console.log(packageVersion())
    return
  }

  if (first.startsWith('-')) {
    throw new Error(`未知参数：${first}（用 pnpm doc help 查看用法）`)
  }

  const command = BY_NAME.get(first)
  if (!command) {
    throw new Error(`未知命令：${first}（可选：${[...BY_NAME.keys()].join('、')}）`)
  }

  // pnpm 有时会透传一个单独的 `--`，它不算参数
  const effectiveRest = rest.filter((token) => token !== '--')
  if (
    effectiveRest.length === 0 &&
    !isInteractive() &&
    BARE_WIZARD_COMMANDS.has(command.meta.name)
  ) {
    printCommandHelp(command.meta)
    console.log('')
    console.log(
      `${c.yellow('!')} 当前不是 TTY：向导不可用，请带上参数` +
        `（如 pnpm doc ${command.meta.name} --try 先预览）`,
    )
    return
  }

  await command.main(rest)
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`${c.red('✗')} ${message}`)
  if (process.env.DEBUG === '1' && error instanceof Error) {
    console.error(error.stack)
  }
  process.exitCode = 1
})
