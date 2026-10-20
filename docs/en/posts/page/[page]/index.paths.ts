/**
 * Route generator for English paginated post lists (build time).
 *
 * Generates page 2 and beyond; page 1 is `/en/posts/`.
 */

import { SITE } from '../../../../../.vitepress/data/site'
import { readPosts } from '../../../../../.vitepress/support/content'
import { pageCount } from '../../../../../.vitepress/theme/support/pagination'

export default {
  watch: ['../../../../**/*.md'],

  paths(): { params: { page: string } }[] {
    const total = pageCount(readPosts('en').length, SITE.postsPerPage)
    return Array.from({ length: Math.max(0, total - 1) }, (_, index) => ({
      params: { page: String(index + 2) },
    }))
  },
}
