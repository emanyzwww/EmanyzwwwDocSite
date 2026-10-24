/**
 * Vite 插件：把媒体管线接到 VitePress 的构建与 dev 上。
 *
 * ## 为什么是插件而不是一个独立的 CLI 步骤
 *
 * `dev` 与 `build` 必须跑**同一份**解析逻辑，否则会出现「本地看着对、
 * CI 产物不同」。插件是唯一能同时覆盖两者的位置：
 *
 * ```text
 * configResolved   → 注入运行期上下文（base / 模式 / 目录）
 * buildStart       → 预扫全部内容、同步 resolve、异步转码（仅 build）
 * generateBundle   → emitFile 把字节交给 Rollup（只 client build）
 * configureServer  → dev 中间件按需转码
 * ```
 *
 * ## 三个必须处理的坑
 *
 * 1. **VitePress 会跑两次 Vite build**（client + SSR）。SSR 的 outDir 是
 *    `.temp` 且结束即被删，所以 emitFile 只在 `config.build.ssr === false`
 *    时做，否则既浪费又可能触发 `emptyOutDir` 相关的意外。
 * 2. **`configureServer` 的中间件必须注册在函数体里**，不能放在返回的后置钩子里
 *    —— 后者排在 SPA fallback 之后，`req.url` 已被改写成 `/index.html`。
 *    注册在函数体里时 `req.url` **仍带 base**，要自己剥。
 * 3. **预扫要同时解析 public/ 下的引用**：作者写的 `/placeholder.svg`
 *    不参与发射（原样拷贝），但必须能被正确解析出自己的 URL，不能报错。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { DOCS_DIR } from '../content'
import { MEDIA_DIR } from './planner'
import {
  allEntries,
  assertReady,
  encodeAll,
  ensureFileByRequest,
  resolveMedia,
  resolveSource,
} from './registry'
import { setMediaRuntime } from './runtime'
import { setMediaCacheDir } from './transcode'
import type { MediaMode } from './types'

/**
 * Vite 插件的最小结构类型。
 *
 * **为什么不 `import type { Plugin } from 'vite'`**：`vite` 只是 vitepress 的
 * 间接依赖，在 pnpm 的严格 node_modules 布局下不会出现在项目根，
 * 引用会随安装方式时好时坏（`env.d.ts` 顶部已记录过同一条判断）。
 * 结构化类型只看成员是否齐全，VitePress 内联的 Plugin 类型能直接满足。
 */
interface VitePluginLike {
  name: string
  configResolved?(config: ResolvedConfigLike): void
  buildStart?(this: RollupContextLike): void | Promise<void>
  generateBundle?(this: RollupContextLike): void | Promise<void>
  configureServer?(server: DevServerLike): void
}

/** `configResolved` 里用到的字段。 */
interface ResolvedConfigLike {
  command: 'build' | 'serve'
  base: string
  publicDir: string
  cacheDir: string
  build: { outDir: string; ssr?: boolean | string }
}

/** dev server 里用到的字段。 */
interface DevServerLike {
  config: { base: string }
  middlewares: {
    use(
      handler: (
        req: { url?: string },
        res: {
          statusCode: number
          setHeader(name: string, value: string): void
          end(chunk?: string | Buffer): void
        },
        next: () => void,
      ) => void,
    ): void
  }
}

/** `this` 上我们只用到 `emitFile`。 */
interface RollupContextLike {
  emitFile(file: { type: 'asset'; fileName: string; source: string | Uint8Array }): string
}

/** 会被扫描的内容扩展名。 */
const CONTENT_EXT = '.md'

/** Markdown 图片引用：`![alt](src)`，允许尖括号包裹与 title。 */
const IMAGE_REF = /!\[[^\]]*\]\(\s*<?([^)>\s]+)>?(?:\s+["'][^"']*["'])?\s*\)/g

/** HTML `<img src>`：少数作者会直接写 HTML，也要能扫到。 */
const IMG_TAG = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi

/** 递归收集 markdown 文件。 */
function collectMarkdown(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) collectMarkdown(full, acc)
    else if (entry.isFile() && entry.name.endsWith(CONTENT_EXT)) acc.push(full)
  }
  return acc
}

/**
 * 预扫：把所有被引用的本地图片解析出来（同步部分）。
 *
 * 只要 resolve 过，`generateBundle` 就有完整 entry 可以直接发射。
 * 这里**吞掉**解析错误：具体报错留给渲染阶段，那里能带上「哪篇文章」的上下文，
 * 而预扫只有文件路径。
 */
function prescan(): void {
  for (const file of collectMarkdown(DOCS_DIR)) {
    let text: string
    try {
      text = readFileSync(file, 'utf-8')
    } catch {
      continue
    }

    for (const pattern of [IMAGE_REF, IMG_TAG]) {
      // 正则带 g，复用前必须重置 lastIndex，否则第二轮从上次位置开始
      pattern.lastIndex = 0
      for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
        const sourcePath = resolveSource(file, match[1])
        if (!sourcePath || !existsSync(sourcePath)) continue
        try {
          resolveMedia(sourcePath)
        } catch {
          // 留给渲染阶段报
        }
      }
    }
  }
}

/** 插件选项。 */
export interface MediaPluginOptions {
  /** 部署 base，与 `config.ts` 的 `BASE` 必须是同一个值。 */
  base: string
}

/**
 * 创建媒体插件。挂载点：`config.ts` 的 `vite.plugins`。
 */
export function mediaPlugin(options: MediaPluginOptions): VitePluginLike {
  let mode: MediaMode = 'build'

  return {
    name: 'vitepress-media',

    configResolved(config) {
      mode = config.command === 'serve' ? 'dev' : 'build'

      setMediaRuntime({
        mode,
        base: config.base,
        srcDir: resolve(DOCS_DIR),
        publicDir: config.publicDir,
        outDir: config.build.outDir,
      })
      // 缓存放 .vitepress/cache/ 下：已被 .gitignore 与 .oxfmtignore 同时忽略
      setMediaCacheDir(resolve(config.cacheDir, 'media'))

      // base 只在这里可能被 Vite 规范化（补前后斜杠），所以以它为准
      void options.base
    },

    async buildStart() {
      /*
       * dev 下**不做**全量预扫：几百张大图会让 `pnpm dev` 启动即卡死。
       * dev 的转码是按需的（见 configureServer）。
       */
      if (mode !== 'build') return

      prescan()
      await encodeAll()
      assertReady()
    },

    async generateBundle() {
      // 只 client build 发射：SSR 的产物目录是 .temp 且结束即删
      if (mode !== 'build') return

      const emitted = new Set<string>()

      for (const entry of allEntries()) {
        // 原图：原样进产物（"放大看完整原图"的前提）
        if (entry.originFileName && !emitted.has(entry.originFileName)) {
          emitted.add(entry.originFileName)
          this.emitFile({
            type: 'asset',
            fileName: entry.originFileName,
            source: readFileSync(entry.sourcePath),
          })
        }

        for (const variant of entry.variants) {
          if (emitted.has(variant.fileName)) continue

          const name = variant.fileName.slice(variant.fileName.lastIndexOf('/') + 1)
          const bytes = entry.files.get(name)
          if (!bytes) continue

          emitted.add(variant.fileName)
          this.emitFile({ type: 'asset', fileName: variant.fileName, source: bytes })
        }
      }
    },

    configureServer(server) {
      const basePrefix = server.config.base

      /* 注册在函数体里（不是返回的后置钩子）：后置钩子排在 SPA fallback 之后，
         那时 req.url 已经是 /index.html，永远收不到图片请求。 */
      server.middlewares.use((req, res, next) => {
        const url = req.url
        if (!url) return next()

        // 此刻 base 还在 url 里，先剥掉
        if (!url.startsWith(basePrefix)) return next()
        const pathname = decodeURIComponent(url.slice(basePrefix.length).split('?')[0] ?? '')

        if (!pathname.startsWith(`${MEDIA_DIR}/`)) return next()

        void (async () => {
          try {
            const bytes = await ensureFileByRequest(pathname)
            if (!bytes) {
              res.statusCode = 404
              res.end('media not found')
              return
            }
            res.setHeader('Content-Type', contentTypeOf(pathname))
            // dev 必须禁缓存：URL 里的指纹只是命名，改了图刷新就要生效
            res.setHeader('Cache-Control', 'no-store')
            res.end(bytes)
          } catch (error) {
            res.statusCode = 500
            res.end(String(error))
          }
        })()
      })
    },
  }
}

/** 按扩展名给 Content-Type。 */
function contentTypeOf(pathname: string): string {
  const ext = pathname.slice(pathname.lastIndexOf('.') + 1).toLowerCase()
  switch (ext) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'svg':
      return 'image/svg+xml'
    case 'avif':
      return 'image/avif'
    default:
      return 'image/webp'
  }
}
