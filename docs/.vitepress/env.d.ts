/**
 * 全局类型补充。
 *
 * 为什么不用 `/// <reference types="vite/client" />`：
 * `vite` 只是 vitepress 的间接依赖，在 pnpm 的严格 node_modules 布局下
 * 不会出现在项目根，引用会随安装方式时好时坏。
 * 这里只声明项目真正用到的两个能力，保证任何安装方式下都稳定。
 */

/** Vite 的资源导入：`?url` 形式返回最终地址。 */
interface ImportMetaGlobOptions {
  eager?: boolean
  query?: string
  import?: string
}

declare interface ImportMeta {
  /**
   * 静态资源批量导入。
   *
   * 用法见 `theme/support/media.ts`：
   * `import.meta.glob('../../../media/*', { eager: true, query: '?url', import: 'default' })`
   */
  glob(pattern: string | string[], options?: ImportMetaGlobOptions): Record<string, unknown>
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}
