/**
 * 指令实现：`:::github` / `:::link` / `:::figure` / `:::quote` / `:::columns` / `:::gallery`。
 *
 * ## 共同纪律（理由写在 `registry.ts` 顶部）
 *
 * 1. **`open()` / `close()` 必须同步、纯函数**：不读网络、不读文件系统。
 * 2. **产物必须是「已经完整」的 HTML**：没有任何"先占位、稍后改写"的标记。
 * 3. **基线永远可用**：`:::github` 在构建期产出的是一个**真实可点的链接**，
 *    运行期增强（`theme/embeds/`）只是往里补描述与元信息。
 *    断网、禁用 JS、接口挂掉——读者看到的仍然是一条能点的链接。
 *
 * ## DOM 设计原则（视觉契约的另一半在 `content.css`）
 *
 * 所有指令都产出同一套骨架，保证六种块看起来是「一家」的：
 *
 * ```text
 * .embed                  容器（决定外边距与对齐）
 *   [.embed__icon]        可选：类型图标（build-time 内联 SVG）
 *   .embed__body          内容主体
 *     .embed__head        头行：标题 / 仓库名 + 右侧站点名
 *     .embed__desc        描述（可选）
 *     .embed__meta        元信息（可选）
 *   [.embed__arrow]       可选：右上角"可以点出去"箭头
 * ```
 *
 * **卡内一律用 `<span>`**：`<a>` 里放 `<p>` 会被浏览器按规范拆开
 * （真实事故：一张卡变成三个并列链接，Vue 报 hydration mismatch）。
 */

import { normalizeRepoSpec, repoPageUrl, splitRepo } from '../../../shared/github'
import { renderIcon } from '../../../shared/icons'
import type { Directive, DirectiveArgs, DirectiveContext } from './registry'

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

/** HTML 文本转义。参数来自作者，必须转。 */
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** HTML 属性值转义。 */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 指令参数错误：带上位置，作者能直接跳过去。 */
function argError(ctx: DirectiveContext, message: string): never {
  throw new Error(`[directives] ${ctx.location}\n${message}`)
}

/** 断言位置参数不超过上限（早失败，别让作者的笔误静默失效）。 */
function expectNoExtra(args: DirectiveArgs, ctx: DirectiveContext, max: number): void {
  if (args.positional.length > max) {
    argError(
      ctx,
      `:::${args.name} 最多接受 ${max} 个位置参数，但收到 ${args.positional.length} 个：` +
        `${args.positional.join(' ')}\n  含空格的参数请用引号包起来。`,
    )
  }
}

/** 断言没有未知的具名参数。 */
function expectKnownKeys(
  args: DirectiveArgs,
  ctx: DirectiveContext,
  allowed: readonly string[],
): void {
  for (const key of Object.keys(args.named)) {
    if (!allowed.includes(key)) {
      argError(
        ctx,
        `:::${args.name} 不认识参数 "${key}"。\n` +
          `  可用参数：${allowed.join(' / ') || '（无）'}`,
      )
    }
  }
}

/** 类型图标。`.embed__icon` 定位在左侧，颜色随 `currentColor`。 */
function typeIcon(name: Parameters<typeof renderIcon>[0]): string {
  return `<span class="embed__icon">${renderIcon(name)}</span>`
}

/* ------------------------------------------------------------------ *
 * `:::github owner/repo`
 * ------------------------------------------------------------------ */

/**
 * GitHub 仓库卡。
 *
 * 构建期产出「图标 + 仓库名 + 站点名 + 一条真链接」，
 * 运行期补描述与元信息（★ / 语言 / 最近推送）。
 *
 * 未增强时卡片只有一行——这是刻意的：**它必须自己看起来是完整的**，
 * 而不是"一个正在等数据的半成品"。
 */
const githubDirective: Directive = {
  name: 'github',
  summary: '把 owner/repo 渲染成 GitHub 仓库卡（构建期只有链接，数据由浏览器补充）',
  example: ':::github vuejs/core',
  body: 'none',
  open(args, ctx) {
    expectNoExtra(args, ctx, 1)
    expectKnownKeys(args, ctx, [])

    const raw = args.positional[0]
    if (!raw) {
      argError(
        ctx,
        ':::github 缺少仓库名。\n' +
          '  写法一：:::github vuejs/core\n' +
          '  写法二：:::github https://github.com/vuejs/core',
      )
    }

    const fullName = normalizeRepoSpec(raw)
    if (!fullName) {
      argError(
        ctx,
        `:::github 无法识别仓库："${raw}"。\n` +
          '  支持 owner/repo（如 vuejs/core）或完整仓库地址（https://github.com/vuejs/core）。',
      )
    }

    const href = repoPageUrl(fullName)
    const { owner, repo } = splitRepo(fullName)

    return (
      `<div class="embed embed--github" data-embed="github" data-target="${escapeAttr(fullName)}">` +
      `<a class="embed__link" href="${escapeAttr(href)}" rel="noopener noreferrer">` +
      typeIcon('github') +
      `<span class="embed__body">` +
      `<span class="embed__head">` +
      `<span class="embed__title"><strong>${escapeHtml(owner)}</strong>` +
      `<span class="embed__slash">/</span>${escapeHtml(repo)}</span>` +
      `<span class="embed__badge">GitHub</span>` +
      `</span>` +
      `<span class="embed__skeleton" aria-hidden="true">` +
      `<span class="embed__sk embed__sk--line"></span>` +
      `<span class="embed__sk embed__sk--line embed__sk--short"></span>` +
      `</span>` +
      `</span>` +
      `<span class="embed__arrow">${renderIcon('external')}</span>` +
      `</a></div>`
    )
  },
  close() {
    return ''
  },
}

/* ------------------------------------------------------------------ *
 * `:::link url [标题]`
 * ------------------------------------------------------------------ */

/**
 * 外部链接卡。
 *
 * 构建期只有链接本身（+ 站点名兜底标题），运行期可以走将来的 OpenGraph
 * 拉取补标题与摘要。**现在不发任何网络请求**——它当前等于一条带样式的链接，
 * 这完全符合预期：能力先留出接口，数据源以后再接。
 */
const linkDirective: Directive = {
  name: 'link',
  summary: '把外部链接渲染成链接卡（构建期只有链接，将来由浏览器补充 OpenGraph 信息）',
  example: ':::link https://example.com 我的标题',
  body: 'none',
  open(args, ctx) {
    expectNoExtra(args, ctx, 2)
    expectKnownKeys(args, ctx, [])

    const raw = args.positional[0]
    if (!raw) {
      argError(ctx, ':::link 缺少链接地址。\n  写法：:::link https://example.com [可选标题]')
    }

    let url: URL
    try {
      url = new URL(raw)
    } catch {
      argError(
        ctx,
        `:::link 的地址不是合法 URL："${raw}"。\n  需要带协议，例如 https://example.com。`,
      )
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      argError(ctx, `:::link 只接受 http(s) 链接，收到 ${url.protocol}`)
    }

    const site = url.hostname.replace(/^www\./, '')
    const custom = args.positional.slice(1).join(' ')
    const title = custom || site
    /*
     * 标题与站点名相同时只显示一次：`:::link https://example.com` 不该
     * 变成「example.com / example.com」两行同样的字。
     */
    const showSite = site !== title

    return (
      `<div class="embed embed--link" data-embed="link" data-target="${escapeAttr(url.href)}">` +
      `<a class="embed__link" href="${escapeAttr(url.href)}" rel="noopener noreferrer">` +
      typeIcon('link') +
      `<span class="embed__body">` +
      `<span class="embed__head">` +
      `<span class="embed__title">${escapeHtml(title)}</span>` +
      (showSite ? `<span class="embed__badge">${escapeHtml(site)}</span>` : '') +
      `</span>` +
      `</span>` +
      `<span class="embed__arrow">${renderIcon('external')}</span>` +
      `</a></div>`
    )
  },
  close() {
    return ''
  },
}

/* ------------------------------------------------------------------ *
 * `:::figure caption="…"`
 * ------------------------------------------------------------------ */

/** `:::figure` 的图注（两个阶段共用的唯一来源）。 */
function figureCaption(args: DirectiveArgs): string {
  const caption = args.named.caption ?? ''
  if (!caption) return ''
  return (
    `<figcaption class="embed__caption">` +
    `<span class="embed__caption-mark" aria-hidden="true"></span>` +
    escapeHtml(caption) +
    `</figcaption>`
  )
}

/**
 * 带图注的图片块。
 *
 * 内部是标准 Markdown 图片。**独占一段时媒体管线本来就会把它升成
 * `<figure class="prose-media">`**（多档 srcset + 点开放大），
 * 于是形成 `figure > figure`——HTML5 合法，且分工清晰：
 * 内层管图片的各种尺寸，外层管图注。
 *
 * 图注用 `caption` 参数而不是图片的 `title`：后者在 Markdown 里的语义是
 * 悬停提示，两者不总是一回事。要精确控制图注时写指令。
 */
const figureDirective: Directive = {
  name: 'figure',
  summary: '带图注的图片块（内部写标准 Markdown 图片）',
  example: ':::figure caption="站点首页截图"\n![首页](./home.png)\n:::',
  body: 'markdown',
  open(args, ctx) {
    expectNoExtra(args, ctx, 0)
    expectKnownKeys(args, ctx, ['caption'])
    return `<figure class="embed embed--figure" data-embed="figure"><div class="embed__media">`
  },
  close(args) {
    return `</div>${figureCaption(args)}</figure>`
  },
}

/* ------------------------------------------------------------------ *
 * `:::quote 出处`
 * ------------------------------------------------------------------ */

/** `:::quote` 的出处行（开/闭两个阶段共用）。 */
function quoteSource(args: DirectiveArgs): string {
  const source = args.named.source ?? args.positional.join(' ')
  if (!source) return ''
  return `<figcaption class="embed__source">${escapeHtml(source)}</figcaption>`
}

/**
 * 引用块 + 出处。
 *
 * 内部走标准 `blockquote`（复用 `content.css` 已有的引用样式：左侧细线 +
 * 次级文字色），出处单独一行右对齐。这是"容器里放原生 Markdown"的示范。
 */
const quoteDirective: Directive = {
  name: 'quote',
  summary: '带出处的引用块（内部写标准 Markdown）',
  example: ':::quote 《C 程序设计语言》\n第一个示例程序打印 “hello, world”。\n:::',
  body: 'markdown',
  open() {
    return (
      `<figure class="embed embed--quote" data-embed="quote">` +
      `<blockquote><span class="embed__quote-mark" aria-hidden="true">${renderIcon('quote')}</span>`
    )
  },
  close(args, ctx) {
    expectKnownKeys(args, ctx, ['source'])
    return `</blockquote>${quoteSource(args)}</figure>`
  },
}

/* ------------------------------------------------------------------ *
 * `:::columns`
 * ------------------------------------------------------------------ */

/**
 * 多列并排。
 *
 * **只负责布局，不负责内容**：内部是任意 Markdown，用 `---` 分隔列
 * （与 frontmatter 无关，这里只是把 `---` 当作列分隔符）。
 *
 * 为什么用 `---`：它天然是「水平的断开」，语义上像分栏线；
 * 而 `\n\n` 空行在 Markdown 里意义不明（是段落还是分栏？）。
 *
 * 窄屏（< 704px）自动降为单列——手机上两栏中文会窄到不可读。
 */
const columnsDirective: Directive = {
  name: 'columns',
  summary: '把内容分成并排的多列（用单独一行的 --- 分隔列）',
  example: ':::columns 2\n左栏内容\n\n---\n\n右栏内容\n:::',
  body: 'markdown',
  split: 'hr',
  open(args, ctx) {
    expectNoExtra(args, ctx, 1)
    expectKnownKeys(args, ctx, [])

    const raw = args.positional[0] ?? '2'
    const count = Number(raw)
    if (!Number.isInteger(count) || count < 2 || count > 3) {
      argError(ctx, `:::columns 的列数必须是 2 或 3，收到 "${raw}"。`)
    }

    /*
     * 列数写成 `data-columns` 而不是内联 style：样式归 CSS
     * （`grid-template-columns: repeat(var(--columns), 1fr)`），
     * 便于窄屏断点整体降为单列。
     */
    return (
      `<div class="embed embed--columns" data-embed="columns" data-columns="${count}">` +
      `<div class="embed__columns">`
    )
  },
  close() {
    return `</div></div>`
  },
}

/* ------------------------------------------------------------------ *
 * `:::gallery`
 * ------------------------------------------------------------------ */

/**
 * 图片画廊（网格）。
 *
 * 内部写若干个标准 Markdown 图片，自动排成网格。
 *
 * 为什么不是"自动把连续图片变成画廊"：那需要嗅探，而嗅探正是这次重构要
 * 消灭的东西（想拼图却拼了、不想拼却被拼了，作者无法表达意图）。
 * 显式写 `:::gallery` 就没有歧义。
 */
const galleryDirective: Directive = {
  name: 'gallery',
  summary: '把多张图片排成网格（内部写标准 Markdown 图片）',
  example: ':::gallery\n![a](./a.png)\n![b](./b.png)\n:::',
  body: 'markdown',
  /*
   * 图片拆段**不在块级做**：块级规则运行时 `inline.children` 还是 `null`
   * （inline 解析发生在稍后的 core 阶段），此时根本看不到图片。
   * 这里只做标记，真正的拆分由 `installSplitImagesRule()` 的 core 规则
   * 按 `env.splitImageRanges` 区间执行——见 `directives/images.ts`。
   */
  splitImages: true,
  open(args, ctx) {
    expectNoExtra(args, ctx, 1)
    expectKnownKeys(args, ctx, [])

    // 可选列数，默认 2
    const raw = args.positional[0] ?? '2'
    const count = Number(raw)
    if (!Number.isInteger(count) || count < 2 || count > 4) {
      argError(ctx, `:::gallery 的列数必须是 2 / 3 / 4，收到 "${raw}"。`)
    }

    return (
      `<div class="embed embed--gallery" data-embed="gallery" data-columns="${count}">` +
      `<div class="embed__gallery">`
    )
  },
  close() {
    return `</div></div>`
  },
}

/** 全部指令。`installDirectives()` 逐个注册。 */
export const DIRECTIVES: readonly Directive[] = [
  githubDirective,
  linkDirective,
  figureDirective,
  quoteDirective,
  columnsDirective,
  galleryDirective,
]
