/**
 * 404 页的无 JS 兜底（仅构建期，由 `buildEnd` 调用）。
 *
 * **为什么需要**：VitePress 生成 `outDir/404.html` 时**不做 SSR**
 * （`<div id="app"></div>` 里是空的），页面内容完全靠客户端渲染。
 * 于是禁用 JS / 脚本加载失败（弱网、拦截器、企业代理）/ 抓取预览时，
 * 用户看到的是一张纯白页，**没有任何返回入口**（实测 `<a>` 数量为 0）。
 *
 * **为什么要写回文件而不是改模板**：`NotFoundPage.vue` 是客户端组件，
 * 它的渲染不在 HTML 里。VitePress 也没有「给 404 注入静态内容」的钩子，
 * 因此只能在构建结束后直接改产物 —— 这与 `writeRobots()` / `writeFeeds()`
 * 的做法一致，都是 `buildEnd` 阶段写盘。
 *
 * **为什么用 `<noscript>` 而不是直接写内容**：正常用户（有 JS）会看到
 * 主题渲染的 404 页，静态内容若直接可见就会和它重复。放在 `<noscript>` 里，
 * 只对「JS 不可用」的那部分人显示，两者互不干扰。
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 给 404 页注入无 JS 兜底。
 *
 * @param outDir 构建产物目录
 * @param base 部署 base，必须以 `/` 开头和结尾
 */
export function writeNotFoundFallback(outDir: string, base: string): void {
  const target = join(outDir, '404.html')

  let html: string
  try {
    html = readFileSync(target, 'utf-8')
  } catch {
    // 没有 404 产物（理论上不会发生），静默跳过，不影响构建
    return
  }

  // 已经注入过就跳过，保证重复调用是幂等的
  if (html.includes('<!-- nojs-404 -->')) return

  /*
   * 兜底内容刻意做成**纯 HTML + 内联样式**：
   * 此时 CSS 可能也加载失败，依赖样式表的排版反而会更难看。
   * 两个语言入口都用带 base 的绝对路径，落在语言首页而不是站点根
   *（根路径是 language 分发页，属于另一套逻辑）。
   */
  const fallback = `
    <!-- nojs-404 -->
    <noscript>
      <div style="max-width:32rem;margin:4rem auto;padding:0 1.5rem;font-family:system-ui,sans-serif;line-height:1.7">
        <p style="font-size:3rem;font-weight:700;margin:0;color:#3358d9">404</p>
        <p style="margin:.5rem 0 1.5rem">这个页面不存在，或者已经被移走了。<br>This page doesn't exist or has been moved.</p>
        <p style="margin:0 0 1rem">
          <a href="${base}zh-cn/" style="color:#3358d9">← 回到首页</a>
        </p>
        <p style="margin:0">
          <a href="${base}en/" style="color:#3358d9">← Back to home</a>
        </p>
      </div>
    </noscript>`

  // 插到 `<body>` 开头：即使 JS 完全没跑，这段也已经在首屏
  const injected = html.replace(/<body([^>]*)>/i, (match) => `${match}${fallback}`)

  // 没匹配到 body（异常产物）就不写，避免把文件改成半截
  if (injected === html) return

  writeFileSync(target, injected, 'utf-8')
}
