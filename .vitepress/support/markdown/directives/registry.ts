/**
 * 块级指令的**类型与注册表**。
 *
 * ## 这一层解决什么问题
 *
 * 改造前，「富内容」（仓库卡）是靠**隐式嗅探**识别的：一段话里只有一个链接、
 * 且显示文本等于 href，就升级成卡片。「图片升 `<figure>`」同理。这条路线有三个
 * 结构性缺陷（详见 `AUDIT-markdown-2026-10-26.md`）：
 *
 * 1. **作者无法表达意图**——想升的没升、不想升的被升，只能改内容去迁就判定；
 * 2. **构建期必须联网**——因为要在渲染时就知道仓库的 stars/描述，而渲染是同步的，
 *    于是只能在 `buildEnd` 事后用正则改写产物 HTML；
 * 3. **产物内部不一致**——改写只覆盖 `dist` 下的 `.html`，覆盖不到客户端路由用的
 *    `.js` chunk，首屏与站内跳转于是渲染出两种结果。
 *
 * ## 改造后的契约（不可协商）
 *
 * ```text
 * 第 0 层  原生 CommonMark + GFM   —— 原样渲染，一个字节都不动
 * 第 1 层  行内自定义语法（高亮）  —— 只在段落内，边界规则严格
 * 第 2 层  块级指令 :::name       —— 所有富内容的唯一入口（本文件管的这层）
 * 第 3 层  运行期增强             —— 只加视觉，不改结构；失败静默回退
 * ```
 *
 * 四条纪律，写在这里是因为它们必须比任何单个指令活得更久：
 *
 * 1. **构建期禁止任何网络请求**。指令的 `render()` 必须是纯同步的，
 *    只允许产出「完整的、可独立使用的 HTML」。
 * 2. **禁止「先占位、稍后改写」**。指令一旦渲染就开始即终态，
 *    没有任何后续阶段再动产物（旧的 `data-repo-card` 标记机制已删除）。
 * 3. **基线必须可用**。没有 JS、断网、接口失败，读者看到的仍是一个真实可点的链接/
 *    可看的图片。运行期增强只能「加」，不能「换」。
 * 4. **未注册的类型必须报错**，且错误信息里列出可用类型——静默降级成本文
 *    会让作者以为语法生效了。
 */

/** 一条指令的解析结果（`:::name key=value positional` 的拆解）。 */
export interface DirectiveArgs {
  /** 指令名，小写，如 `github`。 */
  name: string
  /** 位置参数（按出现顺序），如 `:::github vuejs/core` 里的 `vuejs/core`。 */
  positional: string[]
  /** 具名参数，如 `:::figure caption="图注"` 里的 `caption`。 */
  named: Record<string, string>
}

/** 渲染上下文：指令渲染时需要知道的、与文档位置有关的信息。 */
export interface DirectiveContext {
  /**
   * 源码位置（`文件:行`），仅用于报错。
   *
   * 指令参数非法时，错误信息必须能指到具体哪一行——否则作者只能全文搜索。
   */
  location: string
}

/**
 * 一条指令的实现。
 *
 * 拆成 `open` / `close` 两半而不是一个 `render`，是为了让「有正文的指令」
 * 能把内部 Markdown 的自然产物夹在中间——内部仍由 markdown-it 正常解析，
 * 我们只负责外面那层壳。`body: 'none'` 的指令（`github` / `link`）
 * 只需 `open` 返回整块 HTML、`close` 返回空串。
 */
export interface Directive {
  /** 指令名（`:::name` 的 name）。小写。 */
  name: string
  /**
   * 一句话说明，**会出现在未知指令的报错信息与文档里**。
   * 写"做什么"，不写"怎么实现"。
   */
  summary: string
  /** 参数用法的简短示例，同样会出现在报错信息里，如 `:::github vuejs/core`。 */
  example: string
  /**
   * 是否解析内部正文。
   *
   * - `'none'`：内部内容不解析（无正文的指令用这个；写了内容会被忽略，
   *   所以这类指令要在 `open` 里就别无选择地吃掉整块）；
   * - `'markdown'`：内部的 Markdown 正常递归解析，产物夹在 `open` 与 `close` 之间。
   */
  body: 'none' | 'markdown'
  /**
   * 产出开标签（或整块 HTML）。**必须同步、纯函数**：不得读网络、文件系统，
   * 也不得依赖除 `args` / `ctx` 之外的状态。
   *
   * @throws 参数非法时抛出 `Error`，消息会带上 `ctx.location` 后呈现给作者。
   */
  open(args: DirectiveArgs, ctx: DirectiveContext): string
  /** 产出闭标签。无正文的指令返回空串。 */
  close(args: DirectiveArgs, ctx: DirectiveContext): string
}

/**
 * 指令注册表。
 *
 * 用 `Map` 而不是对象字面量：指令名来自作者输入（`:::xxx`），
 * 对象字面量会让 `constructor`、`__proto__` 这类名字命中原型链，
 * 得到"看起来存在"的错指令。
 */
const registry = new Map<string, Directive>()

/** 注册一条指令。重复注册同名指令直接抛错（配置错误必须在构建期炸出来）。 */
export function defineDirective(directive: Directive): void {
  const name = directive.name.trim().toLowerCase()
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new Error(`指令名非法：${directive.name}（只允许小写字母、数字、连字符）`)
  }
  if (registry.has(name)) throw new Error(`指令重复注册：${name}`)

  registry.set(name, { ...directive, name })
}

/** 取一条指令；没有则 `undefined`。 */
export function getDirective(name: string): Directive | undefined {
  return registry.get(name.trim().toLowerCase())
}

/** 全部已注册的指令名（排序后，供报错信息与文档生成）。 */
export function directiveNames(): string[] {
  return [...registry.keys()].toSorted()
}

/**
 * 拼装「未知指令」的报错信息。
 *
 * 刻意做成一段可直接给作者看的话，而不是 `throw new Error('unknown')`：
 * 作者看到 `:::gihub` 时最需要知道的是「正确拼写是什么」。
 */
export function unknownDirectiveMessage(name: string): string {
  const available = directiveNames()
  const lines = [`未知的指令类型：:::${name}`, '', `可用的指令：${available.join(' / ')}`]

  // 拼写纠错：编辑距离 1~2 时报一个最接近的，比让作者逐个对照有用得多
  const suggestion = closestName(name, available)
  if (suggestion) lines.push(`你是不是想写：:::${suggestion}`)

  lines.push('', '提示：本站的富内容语法统一是 `:::名称 参数` 到 `:::` 的块级容器；')
  lines.push('普通的 Markdown 链接、图片、表格不需要任何指令。')

  return lines.join('\n')
}

/** 找最近似的指令名（只处理明显的笔误，差太远就不猜）。 */
function closestName(input: string, candidates: string[]): string | null {
  const target = input.toLowerCase()
  let best: { name: string; distance: number } | null = null

  for (const name of candidates) {
    const distance = editDistance(target, name)
    if (!best || distance < best.distance) best = { name, distance }
  }

  // 阈值 2：`gihub`→`github` 是 1，`githb`→`github` 是 1；
  // 再放宽就会把 `quote` 猜成 `link` 这类无关结果，反而误导。
  return best && best.distance <= 2 ? best.name : null
}

/** 标准 Levenshtein 距离（指令名很短，O(n·m) 完全够）。 */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1
  const cols = b.length + 1
  // 一维滚动数组：只留上一行
  let previous = Array.from({ length: cols }, (_, index) => index)

  for (let i = 1; i < rows; i += 1) {
    const current = [i]
    for (let j = 1; j < cols; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1)
      const insertion = (current[j - 1] ?? 0) + 1
      const deletion = (previous[j] ?? 0) + 1
      current[j] = Math.min(substitution, insertion, deletion)
    }
    previous = current
  }

  return previous[cols - 1] ?? 0
}

/** 清空注册表（仅供测试）。 */
export function clearDirectives(): void {
  registry.clear()
}
