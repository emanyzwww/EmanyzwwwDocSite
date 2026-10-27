/**
 * 文章 frontmatter 的**唯一字段表**。
 *
 * 这个文件是「有哪些字段」的唯一事实来源，三方都从这里取，谁也不许再自己列一遍：
 *
 * 1. 构建期：`support/content.ts` 读 `title` / `date` / `tags` / `description` / `draft`；
 * 2. 新建：`scripts/new.ts` 按这张表生成**完整**的头部（一个字段都不漏）；
 * 3. 校验与修复：`scripts/check.ts` / `scripts/fix.ts` 按这张表判断缺字段、排顺序、补默认值。
 *
 * 之前字段定义散落在两处：`WRITING.md` 的表格和 `content.ts` 里的 `doc.data.x`。
 * 两边一旦不同步，就会出现「文档写了这个字段、代码根本不认」或者反过来。
 * 现在加字段、改默认值只需要动下面这个数组，文档与命令会一起跟上。
 *
 * 注意：这里**不得**引用任何 Node 内置模块，它会被构建期与命令行共同加载。
 */

/** 字段的值类型。决定命令如何生成与校验它。 */
export type FrontmatterType = 'string' | 'datetime' | 'tags' | 'boolean'

/** 本站支持的全部文章字段。 */
export type FrontmatterKey =
  | 'title'
  | 'slug'
  | 'date'
  | 'tags'
  | 'description'
  | 'draft'
  | 'outline'

/** 一个字段的完整定义。 */
export interface FrontmatterField {
  /** YAML 里的键名。 */
  key: FrontmatterKey
  /** 值类型。 */
  type: FrontmatterType
  /** 是否必填。必填字段缺失时 `check` 报错。 */
  required: boolean
  /** 一句话说明（用于 `pnpm new --help` 与 `check` 的提示）。 */
  summary: string
  /** 省略该字段时会发生什么（与 `WRITING.md` 的表格保持一致）。 */
  fallback: string
  /**
   * `pnpm new` 生成的占位值 / `pnpm fix` 补齐时写入的值。
   *
   * `date` 是空串：真实时刻必须由 `scripts/new.ts` 按北京时间算出来，
   * 塞一个假的默认值只会掩盖错误。
   */
  placeholder: string | readonly string[] | boolean
}

/**
 * 全部字段，**顺序即写入 `index.md` 的顺序**。
 *
 * 必填在前、可选在后，与 `WRITING.md` 的表格、现有文章的头部完全一致，
 * 这样 `pnpm fix` 重排后不会产生无意义的大 diff。
 */
export const FRONTMATTER_FIELDS: readonly FrontmatterField[] = [
  {
    key: 'title',
    type: 'string',
    required: true,
    summary: '文章标题，显示在列表、文章页与浏览器标签',
    fallback: '构建报错',
    placeholder: '未命名文章',
  },
  {
    key: 'slug',
    type: 'string',
    required: false,
    summary: 'URL 段落（/…/YYYYMM/DDNN/<slug>/）；省略时由 title 推导',
    fallback: '由 title 按 `support/slug.ts` 的规则推导',
    placeholder: '',
  },
  {
    key: 'date',
    type: 'datetime',
    required: true,
    summary: '完整时刻（带 +08:00 时区），决定排序、上下篇与时间线分组',
    fallback: '不会被当成文章，按普通页面渲染',
    placeholder: '',
  },
  {
    key: 'tags',
    type: 'tags',
    required: false,
    summary: '标签数组，自动生成标签页并进入标签云',
    fallback: '无标签',
    placeholder: [],
  },
  {
    key: 'description',
    type: 'string',
    required: false,
    summary: '一句话摘要，用于列表卡片、RSS 与 SEO 描述',
    fallback: '自动取正文第一段，截断 160 字',
    placeholder: '',
  },
  {
    key: 'draft',
    type: 'boolean',
    required: false,
    summary: '草稿标记；为 true 时从列表、标签页与 RSS 隐藏（页面仍会生成）',
    fallback: 'false',
    placeholder: false,
  },
  {
    key: 'outline',
    type: 'boolean',
    required: false,
    summary: '是否显示右栏目录；false 时强制关掉',
    fallback: '跟随站点全局设置（默认开）',
    placeholder: true,
  },
]

/** 全部字段名，按写入顺序。 */
export const FRONTMATTER_KEYS: readonly FrontmatterKey[] = FRONTMATTER_FIELDS.map(
  (field) => field.key,
)

/** 必填字段名。 */
export const REQUIRED_FRONTMATTER_KEYS: readonly FrontmatterKey[] = FRONTMATTER_FIELDS.filter(
  (field) => field.required,
).map((field) => field.key)

/** 可选字段名（`fix` 会补这些）。 */
export const OPTIONAL_FRONTMATTER_KEYS: readonly FrontmatterKey[] = FRONTMATTER_FIELDS.filter(
  (field) => !field.required,
).map((field) => field.key)

/**
 * 已废弃字段 → 现在的替代写法。
 *
 * `check` 遇到这些键会提示，但**不会**自动删除：删字段属于改内容语义，
 * 该由作者自己决定（`summary` 仍被 `description` 兼容，删掉只是少一层保险）。
 */
export const DEPRECATED_FRONTMATTER_KEYS: Readonly<Record<string, string>> = {
  hideToc: '改用 outline: false',
  showWordCount: '改为全局开关（.vitepress/data/site.ts 的 wordCount）',
  categories: '已移除，只用 tags',
  summary: '仍兼容为 description，但建议直接写 description',
}

/** 判断一个键是否为本站支持的字段。 */
export function isFrontmatterKey(key: string): key is FrontmatterKey {
  return (FRONTMATTER_KEYS as readonly string[]).includes(key)
}

/** 取某字段的定义，不存在时抛错（拼错键名要立刻暴露，而不是静默忽略）。 */
export function frontmatterField(key: FrontmatterKey): FrontmatterField {
  const field = FRONTMATTER_FIELDS.find((item) => item.key === key)
  if (!field) throw new Error(`未知的 frontmatter 字段：${key}`)
  return field
}
