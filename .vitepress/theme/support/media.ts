/**
 * 媒体资源解析。
 *
 * 仓库根 `media/` 下的图片通过 Vite 的资源导入拿到**带内容指纹**的 URL：
 * 换掉文件内容（哪怕文件名不变）URL 就会变，浏览器缓存自动失效。
 * 这就是旧站 `asset-url.html` + Hugo Pipes 的等价能力，但不需要任何自定义函数。
 *
 * `media/` 与 `public/` 同在仓库根：前者交给 Vite 处理（指纹），后者原样拷贝。
 */

import { withBase } from 'vitepress'

/** 以 `?url` 方式导入，得到的是最终资源地址而不是模块。 */
const files = import.meta.glob('../../../media/*', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

/** 文件名 → 带指纹的 URL。 */
const byName = new Map<string, string>(
  Object.entries(files).map(([path, url]) => [path.split('/').pop() ?? path, url]),
)

/**
 * 把配置里写的文件名解析成可用地址。
 * - 空值 → 空串（调用方据此决定是否渲染）
 * - 外链 / data URI → 原样返回
 * - 能在 `media/` 找到 → 带指纹的地址
 * - 找不到 → 退化为 `public/` 下的同名路径（兼容旧资源）
 */
export function resolveMedia(file: string | undefined): string {
  if (!file) return ''

  const name = file.trim()
  if (!name) return ''
  if (/^(https?:)?\/\//.test(name) || name.startsWith('data:')) return name

  const hit = byName.get(name.split('/').pop() ?? name)
  if (hit) return hit

  return withBase(`/media/${name.replace(/^\/+/, '')}`)
}
