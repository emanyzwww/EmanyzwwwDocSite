/**
 * Route generator for English tag pages (build time, runs in Node).
 *
 * Each tag becomes `/en/tags/<slug>/`.
 */

import { readPosts } from '../../../.vitepress/support/content'

export default {
  watch: ['../../../../**/*.md'],

  paths(): { params: { tag: string } }[] {
    const slugs = new Set<string>()
    for (const post of readPosts('en')) {
      for (const tag of post.tags) slugs.add(tag.slug)
    }

    return [...slugs].sort().map((tag) => ({ params: { tag } }))
  },
}
