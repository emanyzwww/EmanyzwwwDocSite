/**
 * 标签详情页的路由生成器（仅构建期执行，在 Node 里跑）。
 *
 * 每个标签生成一个页面：`/tags/<slug>/`。
 * 标签从文章数据里汇总，因此给文章加上新标签，页面会自动出现，
 * 不需要手写任何标签页文件——这是静态博客最容易腐化的地方。
 *
 * 注意：VitePress 1.6.4 没有 `defineRoutes` 辅助函数（2.x 才有），
 * 因此这里直接 `export default { watch, paths }`。
 */

import { readPosts } from '../../.vitepress/support/content'

export default {
  /** 文章变动时重新生成路由。 */
  watch: ['../../../**/*.md'],

  paths(): { params: { tag: string } }[] {
    const slugs = new Set<string>()
    for (const post of readPosts('root')) {
      for (const tag of post.tags) slugs.add(tag.slug)
    }

    return [...slugs].sort().map((tag) => ({ params: { tag } }))
  },
}
