import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

/**
 * 「构建期零网络」的守卫。
 *
 * ## 为什么值得跑一次完整构建
 *
 * 这条契约（`support/markdown/directives/registry.ts` 顶部纪律 1）是这次重构的
 * 核心：只要构建期还在联网，产物就依赖网络状态，于是「同样的源码，两次构建
 * 结果不同」——旧的 GitHub 卡片正是这么坏掉的（缓存过期就请求，请求失败就
 * 留半张卡，且改写只覆盖 `.html` 不覆盖 `.js`，首屏与站内跳转不一致）。
 *
 * 单元测试测不到这件事：它发生在插件钩子与 `buildEnd` 里。
 * 所以这里**真的跑一次 `vitepress build`**，并把 `globalThis.fetch` 换成
 * 记录器——任何外部请求都会让断言失败。
 *
 * ## 代价与取舍
 *
 * 一次完整构建约 2 秒，在单测里算慢的。但它守的是一条**结构性**契约
 * （且回归过），值得。用 `PNPM_SKIP_OFFLINE_BUILD=1` 可以跳过，
 * 便于只想跑纯函数的场合。
 */

const run = promisify(execFile)

/** 拦截器：把 fetch 替换成「记录 + 报错」，任何出网都会留下痕迹。 */
function createFetchBlocker(logPath: string): string {
  return `
import { appendFileSync } from 'node:fs'
const LOG = ${JSON.stringify(logPath)}
globalThis.fetch = async (input) => {
  const url = typeof input === 'string' ? input : (input?.url ?? String(input))
  appendFileSync(LOG, url + '\\n')
  throw new Error('[offline-build-test] network access is forbidden during build: ' + url)
}
`
}

/** 本地文件读取类（不是出网）——Vite 读 hashmap 会走它，不该算违规。 */
function isLocalRequest(url: string): boolean {
  return url.startsWith('/') || url.startsWith('file:')
}

describe('构建期零网络', () => {
  const skip = process.env.PNPM_SKIP_OFFLINE_BUILD === '1'

  it.skipIf(skip)(
    '断网（fetch 抛错）时 pnpm build 仍然成功，且不发起任何外部请求',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'offline-build-'))
      const blockerPath = join(dir, 'block-fetch.mjs')
      const logPath = join(dir, 'requests.log')

      writeFileSync(blockerPath, createFetchBlocker(logPath), 'utf-8')

      const projectRoot = process.cwd()

      try {
        await run('pnpm', ['build'], {
          cwd: projectRoot,
          shell: true,
          env: {
            ...process.env,
            // 用 --import 注入：Node 22+ 支持，先于用户代码执行
            NODE_OPTIONS: `--import ${new URL(`file:///${blockerPath.replace(/\\/g, '/')}`).href}`,
          },
        })
      } finally {
        // 无论如何都读日志：构建失败时也需要看到它请求了什么
        let requests: string[] = []
        try {
          requests = readFileSync(logPath, 'utf-8').split('\n').filter(Boolean)
        } catch {
          // 一次都没出网 → 日志文件不存在，这正是期望结果
          requests = []
        }

        const external = requests.filter((url) => !isLocalRequest(url))

        try {
          expect(external, `构建期发出了外部请求：\n${external.join('\n')}`).toEqual([])
        } finally {
          rmSync(dir, { recursive: true, force: true })
        }
      }
    },
    120_000,
  )
})
