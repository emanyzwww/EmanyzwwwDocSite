/**
 * 站点 Markdown 能力的**唯一装配点**。
 *
 * ## 为什么需要工厂
 *
 * 改造前，同一段 Markdown 有两套渲染：
 *
 * - 页面正文：VitePress 的实例（attrs / emoji / 内置容器 / 图片 / 高亮 / 任务列表 全有）
 * - 个人简介等非页面 Markdown：这里一个裸 markdown-it
 *   （只有高亮 + 任务列表）
 *
 * 于是 `:::tip` 在正文是提示框、在简介里是字面量 `:::tip`；`{width=100}` 在正文生效、
 * 在简介里残留；图片在正文是 webp + srcset、在简介里是部署后 404 的相对路径。
 *
 * 现在两处都调 `applySiteMarkdown()`，差异只剩「有没有媒体管线」
 * 这一项真实存在的区别（非页面 Markdown 没有 Vite 资产清单可用），
 * 并且由调用方显式声明。
 *
 * ## 装配顺序是有语义的，不要随手调换
 *
 * ```text
 * 1. extendMarkdown     行内语法（==高亮==）+ 任务列表
 * 2. installDirectives  块级指令（:::github …）
 * 3. mediaMarkdown      图片 → <figure> + srcset（仅正文）
 * ```
 *
 * 指令先于媒体：图片要能落在指令内部（`:::figure` 就是靠这个成立）。
 */

import MarkdownIt from 'markdown-it'

import { extendMarkdown } from '../markdown-plugins'
import { installCodeBlocks } from './code-blocks'
import { installDirectives } from './directives/index'

/** 媒体管线安装器（由调用方注入，避免 `support/markdown/` 反向依赖 `support/media/`）。 */
export type MediaInstaller = (md: unknown) => void

/** 装配选项。 */
export interface SiteMarkdownOptions {
  /**
   * 媒体管线安装器。**只在页面正文传**——那里有 Vite 的产物清单可查。
   *
   * 不传表示"没有资产管线"，图片保持 Markdown 里的原始路径
   * （侧栏简介里写站内相对图片本来就没有意义，这是可接受的降级）。
   */
  media?: MediaInstaller
}

/**
 * 把站点的 Markdown 扩展装到一个**已存在**的 markdown-it 实例上。
 *
 * 用于页面正文：`markdown.config(md)` 拿到的是 VitePress 自己的实例，
 * 身上已挂 attrs / emoji / 内置容器等插件，我们只追加自己的部分。
 *
 * ## 装配顺序（有语义，别随手调换）
 *
 * ```text
 * 1. extendMarkdown      行内语法（==高亮==）+ 任务列表
 * 2. media（若提供）      图片 → <figure> + srcset；注册 core 规则 media_figure
 * 3. installDirectives   块级指令 + 图片拆段（要排在 media_figure 之前）
 * ```
 *
 * **第 2 步必须早于第 3 步**：图片拆段的 core 规则要靠 `before('media_figure')`
 * 精确落位。反过来装的话 `media_figure` 还不存在，`before()` 会抛
 * `Parser rule not found`，只能退回「先占位再重排」的复杂写法——
 * 而那种写法要碰 markdown-it 的私有字段 `__rules__`，很脆。
 *
 * @param md markdown-it 实例（收 `unknown`：三份互不兼容的类型声明都能传进来）
 */
export function applySiteMarkdown(md: unknown, options: SiteMarkdownOptions = {}): void {
  extendMarkdown(md as Parameters<typeof extendMarkdown>[0])
  // 媒体管线先装：它的 core 规则是图片拆段的定位锚点
  options.media?.(md)
  installDirectives(md)
  // 代码块增强必须最后装：它包裹的是 VitePress 的 fence 包装器，
  // 装得越晚越靠外层，拿到的 HTML 才稳定（见 code-blocks.ts 顶部说明）。
  installCodeBlocks(md)
}

/**
 * 创建一个装好站点扩展的独立实例（非页面场景：简介、单测）。
 *
 * 单例复用：这些内容每次构建只渲染几次，但实例创建不便宜（要注册整条规则链）。
 */
let renderer: MarkdownIt | null = null

function getRenderer(): MarkdownIt {
  renderer ??= createSiteMarkdown()
  return renderer
}

/** 创建一个**新**的实例（不复用单例）。单测与需要隔离状态的场景用这个。 */
export function createSiteMarkdown(): MarkdownIt {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: false,
  })

  applySiteMarkdown(md)
  return md
}

/**
 * 渲染一段 Markdown 为 HTML 片段。
 *
 * 仅用于构建期的「非页面」场景：个人简介。
 * 页面正文由 VitePress 渲染，不经过这里。
 */
export function renderMarkdown(source: string): string {
  return getRenderer().render(source).trim()
}
