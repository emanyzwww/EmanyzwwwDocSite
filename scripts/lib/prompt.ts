/**
 * 交互提示的薄封装（`@clack/prompts`）。
 *
 * 只做两件事：
 * 1. 统一处理 `Ctrl+C`：打印「已取消」并以 130 退出，而不是把取消符号当成值；
 * 2. 让命令代码只依赖这里，不直接散落 `clack` 的导入。
 */

import * as p from '@clack/prompts'
import type { Option } from '@clack/prompts'

/** 把 clack 的取消符号转成正常流程；用户取消时直接退出。 */
export function exitOnCancel<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel('已取消')
    process.exit(130)
  }
  return value as T
}

/** 确认框（默认「是」）。 */
export async function askConfirm(message: string, initialValue = true): Promise<boolean> {
  return exitOnCancel<boolean>(await p.confirm({ message, initialValue }))
}

/** 文本输入。 */
export async function askText(message: string, placeholder = ''): Promise<string> {
  return exitOnCancel<string>(await p.text({ message, placeholder, defaultValue: '' }))
}

/** 选择一项。 */
export async function askSelect<T extends string>(
  message: string,
  options: readonly Option<T>[],
  initialValue?: T,
): Promise<T> {
  return exitOnCancel<T>(
    await p.select<T>({
      message,
      options: options.map((option) => ({ ...option })),
      ...(initialValue === undefined ? {} : { initialValue }),
    }),
  )
}

/** 多选。 */
export async function askMultiSelect<T extends string>(
  message: string,
  options: readonly Option<T>[],
  initialValues: T[] = [],
): Promise<T[]> {
  return exitOnCancel<T[]>(
    await p.multiselect<T>({
      message,
      options: options.map((option) => ({ ...option })),
      initialValues,
      required: true,
    }),
  )
}

/** 打开一段开场白。 */
export function intro(message: string): void {
  p.intro(message)
}

/** 结束交互。 */
export function outro(message: string): void {
  p.outro(message)
}

export { p }
