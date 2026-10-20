/**
 * 文章列表分页的路由生成器（仅构建期执行）。
 *
 * 只生成第 2 页及以后：第 1 页就是 `/zh-cn/posts/`，避免出现 `/zh-cn/posts/page/1/`
 * 这类与列表首页重复的地址（重复地址对 SEO 不利）。
 * 文章不足两页时不生成任何页面，`/zh-cn/posts/page/2/` 自然 404。
 */

import { SITE } from '../../../../../.vitepress/data/site'
import { readPosts } from '../../../../../.vitepress/support/content'
import { pageCount } from '../../../../../.vitepress/theme/support/pagination'

export default {
  watch: ['../../../../**/*.md'],

  paths(): { params: { page: string } }[] {
    const total = pageCount(readPosts('zh-cn').length, SITE.postsPerPage)
    return Array.from({ length: Math.max(0, total - 1) }, (_, index) => ({
      params: { page: String(index + 2) },
    }))
  },
}
