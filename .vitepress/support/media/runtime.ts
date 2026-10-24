/**
 * 运行期上下文（base / 模式 / 目录）。
 *
 * 单例，由 `media/vite.ts` 在 Vite 的 `configResolved` 里注入一次。
 * 之所以要单例而不是到处传参：markdown-it 的渲染规则签名固定
 * `(tokens, idx, options, env, self)`，没有地方塞自定义参数。
 */

import { resolve } from 'node:path'

import type { MediaMode } from './types'

/** 运行期上下文。 */
export interface MediaRuntime {
  /** `dev` 或 `build`。两者在"何时转码"上不同，命名规则完全一致。 */
  mode: MediaMode
  /** 部署 base，前后都有斜杠（`/` 或 `/repo/`）。 */
  base: string
  /** 内容根（`docs/` 的绝对路径）。 */
  srcDir: string
  /** `public/` 的绝对路径，用于解析作者写的 `/xxx.png`。 */
  publicDir: string
  /** 产物目录的绝对路径。 */
  outDir: string
}

/** 在 vite 插件注入之前的兜底值：只够让纯函数单测与"意外提前渲染"不崩。 */
const FALLBACK: MediaRuntime = {
  mode: 'build',
  base: '/',
  srcDir: resolve(process.cwd(), 'docs'),
  publicDir: resolve(process.cwd(), 'public'),
  outDir: resolve(process.cwd(), '.vitepress/dist'),
}

let runtime: MediaRuntime | null = null

/** 注入上下文（只由 `media/vite.ts` 调用）。 */
export function setMediaRuntime(next: MediaRuntime): void {
  runtime = next
}

/** 读上下文。未注入时返回兜底值，**不抛错**——否则单测与 SSR 的边角路径会直接炸。 */
export function getMediaRuntime(): MediaRuntime {
  return runtime ?? FALLBACK
}
