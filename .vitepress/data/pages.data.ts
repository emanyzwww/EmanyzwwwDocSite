/**
 * 页面路径索引（数据加载器）。
 *
 * 语言切换需要知道「目标语言有没有这个页面」，因此把全部内容页路径下发到客户端。
 * 数据量极小（一条路径一个字符串），比在运行时猜路径可靠得多。
 */

import { defineLoader } from 'vitepress'

import { readPageUrls } from '../support/content'

export interface Data {
  urls: string[]
}

declare const data: Data
export { data }

export default defineLoader({
  watch: ['../../**/*.md'],
  load(): Data {
    return { urls: readPageUrls().toSorted() }
  },
})
