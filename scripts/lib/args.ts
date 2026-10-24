/**
 * 命令行参数解析。
 *
 * 刻意不引第三方库：本站只需要「位置参数 + 少量开关」，一个 60 行的解析器
 * 比多一个依赖更容易审。支持的写法（`pnpm <命令>` 会把参数原样透传）：
 *
 *   pnpm posts 20261024 -l=zh-cn
 *   pnpm posts 20261024 --lang zh-cn --tags=随笔 --json
 *   pnpm new --title="我的文章" -l=en --draft
 *
 * 两个必须处理的细节：
 * 1. pnpm 在某些场景下会把 `--` 一并传进来（实测 `pnpm posts -- --lang=en`
 *    得到的是 `['--', '--lang=en']`），因此这里先剥掉单独的 `--`；
 * 2. `pnpm list` 是 pnpm 的内置命令，会抢在脚本之前解析参数并直接报错
 *    （`unexpected argument '-l' found`）。所以对外统一用 `pnpm posts`，
 *    `list` 只作为 `pnpm run list` 的别名保留。
 */

/** 一个可接受的长/短选项。 */
export interface OptionSpec {
  /** 长名，不含 `--`，如 `lang`。 */
  name: string
  /** 短名，不含 `-`，如 `l`。 */
  short?: string
  /** 布尔开关：出现即为 true，不消费后面的参数。 */
  boolean?: boolean
}

/** 解析结果。 */
export interface CliArgs {
  /** 非选项参数，保持原顺序。 */
  positionals: string[]
  /** 选项名（统一成长名）→ 值。布尔开关的值为 `true`。 */
  options: Map<string, string | true>
}

/**
 * 解析 `process.argv.slice(2)`。
 *
 * @param argv 已去掉 node 与脚本路径的参数数组。
 * @param specs 该命令认识的选项；不认识的 `--x` 会被当成错误抛出，
 *              避免「拼错参数却静默按默认值跑」。
 */
export function parseArgs(argv: string[], specs: OptionSpec[] = []): CliArgs {
  const byName = new Map<string, OptionSpec>()
  for (const spec of specs) {
    byName.set(spec.name, spec)
    if (spec.short) byName.set(spec.short, spec)
  }

  const positionals: string[] = []
  const options = new Map<string, string | true>()

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]

    // pnpm 透传的分隔符，本身没有含义
    if (token === '--') continue

    if (token.startsWith('-')) {
      // `-l=zh-cn` → 名 `l`、值 `zh-cn`；`--lang=zh-cn` 同理
      const trimmed = token.replace(/^-+/, '')
      const eq = trimmed.indexOf('=')
      const rawName = eq === -1 ? trimmed : trimmed.slice(0, eq)
      const inlineValue = eq === -1 ? undefined : trimmed.slice(eq + 1)

      const spec = byName.get(rawName)
      if (!spec) {
        throw new Error(`不认识的参数：${token}（用 --help 查看可用参数）`)
      }

      if (spec.boolean) {
        options.set(spec.name, true)
        continue
      }

      if (inlineValue !== undefined) {
        options.set(spec.name, inlineValue)
        continue
      }

      // `--lang zh-cn`：值在下一个 token
      const next = argv[index + 1]
      if (next === undefined || next.startsWith('-')) {
        throw new Error(`参数 ${token} 缺少值`)
      }
      options.set(spec.name, next)
      index += 1
      continue
    }

    positionals.push(token)
  }

  return { positionals, options }
}

/** 取选项的字符串值。 */
export function optionValue(args: CliArgs, name: string): string | undefined {
  const value = args.options.get(name)
  return typeof value === 'string' ? value : undefined
}

/** 取布尔开关。 */
export function hasOption(args: CliArgs, name: string): boolean {
  return args.options.has(name)
}

/** 判断是否请求了帮助（`-h` / `--help`）。 */
export function wantsHelp(args: CliArgs): boolean {
  return hasOption(args, 'help')
}
