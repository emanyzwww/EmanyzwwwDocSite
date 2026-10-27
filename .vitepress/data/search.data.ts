/**
 * 站内搜索索引（数据加载器）。
 *
 * **为什么自己建索引而不是开 `themeConfig.search`**：
 * VitePress 内置的 local search 是默认主题的 `VPNavBarSearch` 提供的，
 * 本站是完全自绘的主题（没有 `themeConfig`、没用任何 VP 组件），
 * 开那个开关只会生成索引文件、却没有任何 UI 触发它。
 * 所以这里只复用它的数据形态（标题 + 正文片段 + 锚点），自己渲染面板。
 *
 * **为什么在构建期把正文压成纯文本**：
 * 浏览器端只做「小写包含」匹配，不需要把整站 HTML 下发。
 * 现在 2 篇文章约 8KB，文章涨到 200 篇也只有几百 KB，
 * 且由 VitePress 的数据加载器内联进 chunk，不额外发请求。
 *
 * 索引按语言分组：中文站搜不到英文文章（反过来也一样），
 * 与站点的 i18n 结构一致。
 */

import { defineLoader } from 'vitepress'

import { plainText } from '../support/format'
import type { LocaleCode } from '../types'

/** 一条可被搜索的记录。 */
export interface SearchDoc {
  /** 页面标题。 */
  title: string
  /** 站点内路径（不含 base），如 `/zh-cn/202610/1901/你好，世界/`。 */
  url: string
  /** 页面描述；没有时为空串。 */
  description: string
  /** 正文纯文本（已截断，仅用于匹配与摘要）。 */
  text: string
  /** 标签名（已拼接，便于「按标签找文章」时也能命中）。 */
  tags: string
  /** 所属语言。 */
  locale: LocaleCode
  /** 页面类型，用于结果里显示小标签。 */
  kind: 'post' | 'page'
}

export interface Data {
  docs: SearchDoc[]
}

declare const data: Data
export { data }

/** 正文参与索引的最大长度：超出的部分对「找到这篇文章」没有增益。 */
const MAX_TEXT_LENGTH = 4000

export default defineLoader({
  watch: ['../../docs/**/*.md'],
  async load(): Promise<Data> {
    // 动态导入：本模块只在构建期执行，避免把 Node 依赖带进客户端 bundle
    const { readDocs } = await import('../support/content')
    const { isArticlePath } = await import('../support/article-path')
    const { parseDate } = await import('../support/format')

    const docs: SearchDoc[] = []

    for (const doc of readDocs()) {
      // 草稿不进搜索：与列表页、RSS 的口径一致
      if (doc.data.draft === true) continue

      // 动态路由模板（`[tag]`、`[page]`）本身不是页面，跳过
      if (doc.filePath.includes('[')) continue

      // 文章判定与 `support/content.ts` 的 `isPost()` 同源：路径形态 + 有日期
      const isPost = isArticlePath(doc.filePath) && parseDate(doc.data.date) !== null

      const title =
        typeof doc.data.title === 'string' && doc.data.title.trim() ? doc.data.title : doc.filePath

      const description = typeof doc.data.description === 'string' ? doc.data.description : ''

      /*
       * 标签独立成一个字段而不是并进正文：
       * 用户按标签名搜（例如「随笔」）时，标签往往**不在正文里**出现，
       * 只并进 text 会让这类查询落空；单独存一份又能给它更高权重。
       */
      const rawTags = Array.isArray(doc.data.tags) ? (doc.data.tags as unknown[]) : []
      const tags = rawTags.filter((tag): tag is string => typeof tag === 'string').join(' ')

      /*
       * 先剥掉 VitePress 的 attrs 语法 `{width=100}` / `{data-plain}` 再压纯文本。
       *
       * `plainText` 只处理 Markdown 标记，不认识这种属性写法，会把它当正文
       * 原样留下（搜索摘要里就会看到「图 {width=100}」）。
       * 这不是安全题：只是把不该被读到的语法噪音清掉。
       *
       * 正则用 `\{[^{}]*\}` 而不是原来的 `\{[^{}]*=[^{}]*\}`：
       * **无值属性**（`{data-plain}`、`{data-lightbox}`）没有 `=`，
       * 旧写法漏掉它们，会直接漏进搜索索引（实测过）。
       * 花括号在正文里极罕见，放宽到「整对花括号」是安全的。
       */
      const body = doc.body.replace(/\{[^{}]*\}/g, ' ')

      docs.push({
        title,
        url: doc.url,
        description,
        text: plainText(body).slice(0, MAX_TEXT_LENGTH),
        tags,
        locale: doc.locale,
        kind: isPost ? 'post' : 'page',
      })
    }

    return { docs }
  },
})
