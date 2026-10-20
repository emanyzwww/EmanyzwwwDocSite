/**
 * robots.txt 生成（仅构建期，由 `buildEnd` 调用）。
 *
 * 为什么不在 `public/robots.txt` 里写死：
 * 项目型 GitHub Pages 的站点根是 `/<repo>/`，而 `Sitemap:` 必须是**绝对地址**
 * （robots 协议不允许相对路径）。写死的域名在部署到 Pages 后就会指向一个
 * 根本不存在的站点，所以这里与 sitemap 共用同一个 hostname（由调用方传入）。
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 写出 robots.txt。
 *
 * @param outDir 构建产物目录
 * @param sitemapUrl sitemap 的绝对地址（与 `sitemap.hostname` 同源，含部署 base）
 */
export function writeRobots(outDir: string, sitemapUrl: string): void {
  const content = `User-agent: *
Allow: /

Sitemap: ${sitemapUrl}
`

  writeFileSync(join(outDir, 'robots.txt'), content, 'utf-8')
}
