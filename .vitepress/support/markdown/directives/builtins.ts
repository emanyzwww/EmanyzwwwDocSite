/**
 * 指令实现：`:::github` / `:::link` / `:::figure` / `:::quote`。
 *
 * ## 共同纪律（每一条都在 `registry.ts` 里写死了理由）
 *
 * 1. **`open()` / `close()` 必须同步、纯函数**：不读网络、不读文件系统。
 * 2. **产物必须是「已经完整」的 HTML**：没有任何"先占位、稍后改写"的标记。
 * 3. **基线永远可用**：`:::github` 在构建期产出的是一个**真实可点的链接**，
 *    运行期增强（`theme/embeds/`）只是往里补描述与元信息。
 *    断网、禁用 JS、接口挂掉——读者看到的仍然是一条能点的链接。
 *
 * 第 3 条是这次重构的核心收益：它让「构建期联网」这件事在结构上不再必要。
 */

import { normalizeRepoSpec, repoPageUrl, splitRepo } from '../../../shared/github'
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

/* ------------------------------------------------------------------ *
 * `:::github owner/repo`
 * ------------------------------------------------------------------ */

/**
 * GitHub 仓库卡。
 *
 * 构建期产出：
 *
 * ```html
 * <div class="embed embed--github" data-embed="github" data-target="vuejs/core">
 *   <a class="embed__link" href="https://github.com/vuejs/core">
 *     <span class="embed__repo"><strong>vuejs</strong>/core</span>
 *     <span class="embed__site">GitHub</span>
 *   </a>
 * </div>
 * ```
 *
 * 这就是「已完成的 HTML」：一条真链接，链接文字就是仓库名。
 * 运行期 `theme/embeds/github.ts` 读到 `data-embed` 后去补描述/★/语言，
 * 补成功就换成卡片版式，失败就保持现在这条链接——**不需要任何回退逻辑**，
 * 因为基线本身就是可用的。
 *
 * 与旧实现的关键差别：旧版在渲染期打电话拿数据、拿不到就输出"半张卡"
 * （`github-card--pending`，没有对应样式），那才是"显示有问题"的来源。
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
    /*
     * 仓库名与站点名包在 `.embed__head` 里：增强后运行期会往**链接内部、
     * head 之后**追加描述与元信息，所以 head 必须是一个独立的行容器。
     * 给定这个结构，增强代码就不必解析文本、也不必再包一层。
     */
    return (
      `<div class="embed embed--github" data-embed="github" data-target="${escapeAttr(fullName)}">` +
      `<a class="embed__link" href="${escapeAttr(href)}" rel="noopener noreferrer">` +
      `<span class="embed__head">` +
      `<span class="embed__repo"><strong>${escapeHtml(owner)}</strong>/${escapeHtml(repo)}</span>` +
      `<span class="embed__site">GitHub</span>` +
      `</span></a></div>`
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
 * 构建期只有一条链接（带 `data-embed="link"`），运行期将来可以走
 * OpenGraph 拉取来补标题与摘要。**现在不做任何网络请求**，
 * 也就是说它当前的行为等于一条带样式的链接——这完全符合预期：
 * 能力先留出接口，数据源以后再接。
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

    /*
     * 标题可选：作者不写就用域名兜底，这样卡片在任何情况下都有内容，
     * 不会出现"一个空盒子等网络"的中间态。
     */
    const site = url.hostname.replace(/^www\./, '')
    const title = args.positional.slice(1).join(' ') || site

    return (
      `<div class="embed embed--link" data-embed="link" data-target="${escapeAttr(url.href)}">` +
      `<a class="embed__link" href="${escapeAttr(url.href)}" rel="noopener noreferrer">` +
      `<span class="embed__head">` +
      `<span class="embed__title">${escapeHtml(title)}</span>` +
      `<span class="embed__site">${escapeHtml(site)}</span>` +
      `</span></a></div>`
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
  return caption ? `<figcaption class="embed__caption">${escapeHtml(caption)}</figcaption>` : ''
}

/**
 * 带图注的图片块。
 *
 * 正文里放一个标准的 Markdown 图片。**独占一段时媒体管线本来就会把它
 * 升成 `<figure class="prose-media">`**（多档 srcset + 点开放大），
 * 所以这里会形成 `figure > figure` —— 这在 HTML5 里是合法的，
 * 且分工清晰：内层负责图片本身的各种尺寸，外层负责图注。
 *
 * 为什么不复用自动升级：自动升级只拿 `title` 当图注，而 `title` 在
 * Markdown 里的语义是"悬停提示"，两者不总是一回事。要精确控制图注时写指令。
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

/**
 * 引用块 + 出处。
 *
 * 内部正文走标准 `blockquote`（继续用原生的引用样式），出处单独一行。
 * 这是"容器里放原生 Markdown"的示范：容器只负责加一层语义与出处，
 * 内部的段落、列表、代码块全部还是原生解析。
 */
const quoteDirective: Directive = {
  name: 'quote',
  summary: '带出处的引用块（内部写标准 Markdown）',
  example: ':::quote 《C 程序设计语言》\n第一个示例程序打印 “hello, world”。\n:::',
  body: 'markdown',
  open() {
    /*
     * 用 `<figure>` + `<blockquote>` 而不是 `<div>`：这是引用内容的正确语义，
     * 读屏软件会念成「引用」，且 `content.css` 的 `blockquote` 样式直接复用。
     */
    return `<figure class="embed embed--quote" data-embed="quote"><blockquote>`
  },
  close(args) {
    const source = args.named.source ?? args.positional.join(' ')
    const sourceHtml = source
      ? `<figcaption class="embed__source">${escapeHtml(source)}</figcaption>`
      : ''
    return `</blockquote>${sourceHtml}</figure>`
  },
}

/** 全部指令。`installDirectives()` 逐个注册。 */
export const DIRECTIVES: readonly Directive[] = [
  githubDirective,
  linkDirective,
  figureDirective,
  quoteDirective,
]
