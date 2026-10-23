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

  /**
   * Vite 注入的环境常量。
   *
   * 目前只用到 `BASE_URL`（部署 base，根部署为 `/`，GitHub Pages 项目站点
   * 为 `/<repo>/`）。它由 Vite 在构建期静态替换，因此可以在非组件的纯函数里用，
   * 也不依赖 `useData()`——这正是 `theme/support/paths.ts` 需要它的原因。
   */
  readonly env: {
    readonly BASE_URL: string
    readonly MODE: string
    readonly DEV: boolean
    readonly PROD: boolean
    readonly SSR: boolean
  }
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}
