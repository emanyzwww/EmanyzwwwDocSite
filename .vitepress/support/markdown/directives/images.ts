/**
 * 图片拆段：把「同一段里的连续图片」拆成每图一段（core 规则）。
 *
 * ## 为什么必须是 core 规则
 *
 * `:::gallery` 的容器里，作者连着写两行图片：
 *
 * ```markdown
 * ![a](./a.png)
 * ![b](./b.png)
 * ```
 *
 * Markdown 会把它解析成**同一个段落**（软换行是 `inline` 内部的 `softbreak`，
 * 不是块边界）：
 *
 * ```text
 * paragraph_open / inline(children: image, softbreak, image) / paragraph_close
 * ```
 *
 * 而媒体管线的 `soleImageOf()` 要求 children 里只有一个 image，于是两张图
 * **都不会**升成 `<figure>`，而是两个裸 `<img>` 躺在同一个 `<p>` 里——
 * 画廊网格会把整段当成一格。
 *
 * **关键时序**：块级规则执行时 `inline.children` 还是 `null`，
 * inline 解析发生在稍后的 core 阶段。所以拆分只能挂在 core 的 `inline` 之后
 * （块级那边只负责把「哪些区间要拆」记进 `env`）。
 *
 * ## 为什么不用 CSS 解决
 *
 * 理论上可以用 `display: grid` 直接排 `<p>` 里的 `<img>`，但那样：
 * - 图片失去 `<figure>` 与点开放大（`prose-media__link`）；
 * - `<p>` 内不能放 `<figure>`，而图片的骨架/LQIP/角标都挂在 figure 链路上。
 *
 * 所以在 token 层面拆开、让既有媒体管线各自升级，是唯一不牺牲功能的做法。
 */

/* ------------------------------------------------------------------ *
 * 最小结构类型
 * ------------------------------------------------------------------ */

/**
 * 规则名。
 *
 * 起名 `directive_split_images` 而不是 `split_images`：core 规则名是全局
 * 命名空间，加前缀便于在 `md.core.ruler.__rules__` 里一眼认出是本模块的。
 */
const RULE_NAME = 'directive_split_images'

interface CoreToken {
  type: string
  content: string
  children?: CoreToken[] | null
  block?: boolean
  hidden?: boolean
  map?: [number, number] | null
}

interface CoreState {
  tokens: CoreToken[]
  env: Record<string, unknown>
  /**
   * markdown-it 的 Token 构造器。
   *
   * **必须用它造新 token，不能用对象字面量**：Token 实例上带有
   * `attrIndex` / `attrSet` / `attrGet` 等方法，渲染器与后续规则（attrs、
   * media_figure）都会调用。字面量对象会渲染成 `<undefined>`——真实踩过。
   */
  Token: new (type: string, tag: string, nesting: -1 | 0 | 1) => CoreToken
}

/** 可以挂 core 规则的 markdown-it 实例。 */
export interface DirectiveCoreMarkdownIt {
  core: {
    ruler: {
      after(after: string, name: string, rule: (state: CoreState) => void): void
      before(before: string, name: string, rule: (state: CoreState) => void): void
    }
  }
}

/* ------------------------------------------------------------------ *
 * 规则
 * ------------------------------------------------------------------ */

/** 只放行「图、软换行、空白文本」——出现别的就不拆，避免破坏有语义的段落。 */
function isImageOnly(children: CoreToken[]): boolean {
  return children.every(
    (child) =>
      child.type === 'image' ||
      child.type === 'softbreak' ||
      (child.type === 'text' && child.content.trim() === ''),
  )
}

/**
 * 在指定区间内，把「多图段落」拆成每图一段。
 *
 * @param state core 状态（`tokens` 会被就地修改）
 * @param from 区间起点（含）
 * @param to 区间终点（不含）
 */
function splitInRange(state: CoreState, from: number, to: number): void {
  const tokens = state.tokens

  /*
   * 倒序扫描：每处理一处就把 3 个 token 换成 N×3 个，正序会让后续下标漂移。
   * `index >= from` 且 `index + 2 < to` 保证三连完整落在区间内。
   */
  for (let index = to - 3; index >= from; index -= 1) {
    if (tokens[index]?.type !== 'paragraph_open') continue
    if (tokens[index + 1]?.type !== 'inline') continue
    if (tokens[index + 2]?.type !== 'paragraph_close') continue

    const inline = tokens[index + 1]
    const children = inline?.children
    if (!children || children.length < 2) continue

    if (!isImageOnly(children)) continue

    const images = children.filter((child) => child.type === 'image')
    if (images.length < 2) continue

    /*
     * 一张图一个段落。每个新 inline 的 children 恰好一个 image ——
     * 这正是 `soleImageOf()` 要的形态，媒体管线会各自升成 `<figure>`。
     *
     * 用 `state.Token` 造 token（不是对象字面量）：渲染器会调用 token 上的
     * `attrGet` 等方法，字面量会渲染成 `<undefined>`。
     */
    const replacement: CoreToken[] = []
    for (const image of images) {
      const open = new state.Token('paragraph_open', 'p', 1)
      open.block = true
      open.map = inline.map ?? null

      const content = new state.Token('inline', '', 0)
      content.content = inline.content
      content.children = [image]

      const close = new state.Token('paragraph_close', 'p', -1)
      close.block = true

      replacement.push(open, content, close)
    }

    tokens.splice(index, 3, ...replacement)
  }
}

/**
 * 安装图片拆段规则。
 *
 * ## 顺序（改错就会静默失效）
 *
 * 拆段必须排在 `media_figure` **之前**：
 *
 * ```text
 * inline → directive_split_images → media_figure → …
 * ```
 *
 * 因为 `media_figure` 只在「段落里恰好一张图」时才升 `<figure>`。若排在它后面，
 * 它看到的是「一段两张图」，两张都不升；等我们拆完段落已渲染完毕，
 * 再没有规则回头处理——表现为画廊里是两张裸 `<img>`。
 *
 * ## 依赖装配顺序
 *
 * `applySiteMarkdown()` **先装媒体管线、再装指令**，所以这里 `media_figure`
 * 一定已经存在，`before()` 可以直接命中。
 * 反过来装就得碰 markdown-it 的私有字段 `__rules__` 做重排（很脆），
 * 那条路线已经废弃——保持这个调用顺序即可。
 *
 * 非页面场景（侧栏简介）不装媒体管线，此时没有 `media_figure`，
 * 退回 `after('inline')`：那里也不需要升级 figure。
 */
export function installSplitImagesRule(md: DirectiveCoreMarkdownIt): void {
  const rule = createSplitRule()

  try {
    md.core.ruler.before('media_figure', RULE_NAME, rule)
  } catch {
    md.core.ruler.after('inline', RULE_NAME, rule)
  }
}

/** 拆段规则本体（`installSplitImagesRule` 与重排共用一份实现）。 */
function createSplitRule(): (state: CoreState) => void {
  return (state) => {
    const ranges = state.env.splitImageRanges as Array<[number, number]> | undefined
    if (!ranges || ranges.length === 0) return

    /*
     * 区间按「后进先出」处理：内层指令的区间起点更大，
     * 先处理内层，外层区间里那些已拆好的段落不会再被重复拆
     * （拆完的每段只有一张图，`images.length < 2` 自动跳过）。
     */
    for (const [from, to] of ranges.toSorted((a, b) => b[0] - a[0])) {
      splitInRange(state, from, to)
    }

    // 用完即弃：同一个 env 可能被复用（例如嵌套解析），留着会误伤其他块
    delete state.env.splitImageRanges
  }
}
