/**
 * 移动端断点一致性校验（构建期执行）。
 *
 * 为什么需要它：CSS 不能 import TS，`theme/support/device.ts` 里的
 * `MOBILE_MEDIA` 只能在 `theme/styles/*.css` 里手抄。这个断点已经漂移过一次
 * —— `lightbox.css` 曾经只写 `max-width: 720px`，横屏手机下胶囊已经切成
 * 移动形态、查看器却还是桌面形态，而且不报错，只在特定设备上显形。
 * 所以把「一致性」变成构建失败，而不是靠人记得同步。
 *
 * 规则：`theme/styles/*.css` 中任何 `@media` 条件里出现 `720px` 的，
 * 必须与 `MOBILE_MEDIA` 的完整条件逐字一致（忽略空白差异）。
 * 注释里的引用不会被扫描（只认 `@media` 那一行）。
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { MOBILE_MEDIA } from '../theme/support/device'

const STYLE_DIR = fileURLToPath(new URL('../theme/styles/', import.meta.url))
const EXPECTED = normalize(`@media ${MOBILE_MEDIA}`)

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/** 校验所有手抄的移动端媒体查询；不一致时抛错（dev 与 build 都会在启动阶段失败）。 */
export function assertMobileBreakpoints(): void {
  const offenders: string[] = []

  for (const file of readdirSync(STYLE_DIR).filter((name) => name.endsWith('.css'))) {
    const lines = readFileSync(join(STYLE_DIR, file), 'utf8').split('\n')

    lines.forEach((line, index) => {
      // 只认行首的 `@media`：注释里引用条件（如 mobile.css 顶部那段说明）不算规则
      if (!/^\s*@media\b/.test(line) || !line.includes('720px')) return

      const start = line.indexOf('@media')
      const end = line.indexOf('{', start)
      const condition = normalize(line.slice(start, end === -1 ? undefined : end))
      if (condition !== EXPECTED) {
        offenders.push(`  theme/styles/${file}:${index + 1}  ${condition}`)
      }
    })
  }

  if (offenders.length > 0) {
    throw new Error(
      '移动端断点与 theme/support/device.ts 的 MOBILE_MEDIA 不一致：\n' +
        `${offenders.join('\n')}\n\n` +
        `期望：${EXPECTED}\n` +
        'CSS 无法 import TS，所以这里做构建期校验。请把上面的条件改成期望值；' +
        '如果确实需要不同断点，请先改 device.ts 并同步所有手抄处。',
    )
  }
}
