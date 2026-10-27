/**
 * 构建期收集「VitePress 已渲染好的页面正文」。
 *
 * 为什么需要这个模块（这是 RSS 图片全裂的根治办法）：
 *
 * `support/markdown.ts` 用的是**裸 markdown-it**，它不走 Vite 的资源管线。
 * 于是 Markdown 里的相对图片 `![x](./banner.webp)`：
 * - 在网页上是 `/assets/banner.<hash>.webp`（VitePress 的渲染器做了 fingerprint）；
 * - 在 RSS 里却还是 `./banner.webp` —— 这个地址部署后**根本不存在**，
 *   阅读器按 feed 地址解析必然 404。
 *
 * 之前 `rss.ts` 想在渲染后拿正则把相对路径补成绝对，但补出来的
 * `.../hello-world/banner.webp` 依然是 404，因为真正的文件在 `/assets/` 下。
 * 同理 `{width=100}` 这类 VitePress attrs 语法也会原样泄漏进 feed，
 * 因为裸 markdown-it 没挂 attrs 插件。
 *
 * 结论：**不要在 RSS 里重新渲染一遍 Markdown**。VitePress 已经把页面
 * 渲染好了（含图片指纹、attrs 处理、代码高亮、标题锚点），
 * 只要在 `transformHtml` 阶段把正文抓下来，RSS 直接复用即可。
 * 这样「网页正文」与「RSS 正文」天然一致，不会再有两套渲染口径。
 *
 * 生命周期：`transformHtml` 每渲染完一个页面就写入一次，
 * 全部页面渲染完成后 `buildEnd` 才被调用，所以那时 Map 是完整的。
 */

/** 相对 `docs/` 的路径（含语言前缀）→ 渲染好的正文 HTML。 */
const renderedContent = new Map<string, string>()

/**
 * 从整页 HTML 里截出 `.prose` 内部的内容。
 *
 * 用**深度计数**而不是正则：正文里必然含有嵌套的 `<div>`（例如代码块容器
 * `div[class*="language-"]`），非贪婪正则会在第一个 `</div>` 就截断，
 * 把文章切掉一半。
 */
function extractProse(html: string): string {
  const openTag = '<div class="prose">'
  const start = html.indexOf(openTag)
  if (start === -1) return ''

  const body = html.slice(start + openTag.length)
  const tagPattern = /<div\b|<\/div>/g
  let depth = 1
  let end = -1

  for (let match = tagPattern.exec(body); match; match = tagPattern.exec(body)) {
    if (match[0] === '<div') {
      depth += 1
    } else {
      depth -= 1
      if (depth === 0) {
        end = match.index
        break
      }
    }
  }

  if (end === -1) return ''
  return body.slice(0, end).trim()
}

/**
 * 记录一个页面的正文。
 *
 * 只记录同时满足「有 `.prose` 容器」且「正文非空」的页面；
 * 首页 / 列表页 / 标签页用的是自定义布局，没有 `.prose`，
 * 它们本来也不进 RSS。
 *
 * @param relativePath VitePress 的 `pageData.relativePath`。文章经过 `rewrites`
 *   之后它是 **route 路径**（`zh-cn/202610/1901/你好，世界/index.md`），
 *   与 `RawDoc.routePath` 同一口径；RSS 由 `post.url` 反推出的也是它。
 * @param html 整页 HTML（`transformHtml` 的 `code` 参数）
 */
export function collectRenderedContent(relativePath: string, html: string): void {
  if (!relativePath.endsWith('.md')) return

  const prose = extractProse(html)
  if (prose) renderedContent.set(relativePath, prose)
}

/** 取某页已渲染的正文；没有则返回 `undefined`。 */
export function getRenderedContent(relativePath: string): string | undefined {
  return renderedContent.get(relativePath)
}
