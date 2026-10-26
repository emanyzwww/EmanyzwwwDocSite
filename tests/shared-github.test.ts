import { describe, expect, it } from 'vitest'

import {
  compactNumber,
  daysSince,
  normalizeRepoSpec,
  parseGitHubRepo,
  repoPageUrl,
  splitRepo,
} from '../.vitepress/shared/github'

/**
 * `shared/github` 的纯函数层。
 *
 * 这里只放「构建期与运行期共用的语言」：URL 解析、参数归一化、数字与时间格式化。
 *
 * 构建期只产出一条链接（`:::github` 的基线），仓库数据由浏览器补
 * （见 `theme/embeds/`）。因此构建期不联网、不读缓存、不改写产物——
 * 这条路线上的模块（`support/github-cards*.ts`）已整段删除，
 * 理由记在 `config.ts` 的 `buildEnd` 注释里。
 */

describe('parseGitHubRepo', () => {
  it('识别仓库主页', () => {
    expect(parseGitHubRepo('https://github.com/vuejs/core')).toEqual({
      owner: 'vuejs',
      repo: 'core',
    })
  })

  it('子路径归到仓库（issues / blob / pull）', () => {
    for (const url of [
      'https://github.com/vuejs/core/issues',
      'https://github.com/vuejs/core/blob/main/README.md',
      'https://github.com/vuejs/core/pull/1',
    ]) {
      expect(parseGitHubRepo(url)).toEqual({ owner: 'vuejs', repo: 'core' })
    }
  })

  it('去掉 .git 后缀（clone 地址）', () => {
    expect(parseGitHubRepo('https://github.com/vuejs/core.git')).toEqual({
      owner: 'vuejs',
      repo: 'core',
    })
  })

  it('接受 www.github.com', () => {
    expect(parseGitHubRepo('https://www.github.com/vuejs/core')).toEqual({
      owner: 'vuejs',
      repo: 'core',
    })
  })

  it('个人主页不是仓库（只有一段）', () => {
    expect(parseGitHubRepo('https://github.com/vuejs')).toBeNull()
  })

  it('保留页 / 营销页不是仓库', () => {
    for (const url of [
      'https://github.com/features/actions',
      'https://github.com/security/advisories',
      'https://github.com/pricing/teams',
      'https://github.com/topics/javascript',
      'https://github.com/orgs/nodejs/repositories',
    ]) {
      expect(parseGitHubRepo(url)).toBeNull()
    }
  })

  it('其它站点与非 URL', () => {
    expect(parseGitHubRepo('https://gitlab.com/a/b')).toBeNull()
    expect(parseGitHubRepo('https://gist.github.com/a/b')).toBeNull()
    expect(parseGitHubRepo('不是 URL')).toBeNull()
  })
})

describe('normalizeRepoSpec（指令参数解析）', () => {
  it('短名原样通过', () => {
    expect(normalizeRepoSpec('vuejs/core')).toBe('vuejs/core')
    expect(normalizeRepoSpec('  vuejs/core  ')).toBe('vuejs/core')
  })

  it('大小写保留（GitHub 用户名不区分大小写，但显示要保留原样）', () => {
    expect(normalizeRepoSpec('VueJS/Core')).toBe('VueJS/Core')
  })

  it('完整链接归一化成短名', () => {
    expect(normalizeRepoSpec('https://github.com/vuejs/core')).toBe('vuejs/core')
    expect(normalizeRepoSpec('https://github.com/vuejs/core/')).toBe('vuejs/core')
    expect(normalizeRepoSpec('https://github.com/vuejs/core/issues/1')).toBe('vuejs/core')
    expect(normalizeRepoSpec('https://github.com/vuejs/core.git')).toBe('vuejs/core')
  })

  it('尖括号包裹的 autolink 形态', () => {
    expect(normalizeRepoSpec('<https://github.com/vuejs/core>')).toBe('vuejs/core')
  })

  it('非法输入返回 null（由指令报错，而不是产出坏卡片）', () => {
    expect(normalizeRepoSpec('')).toBeNull()
    expect(normalizeRepoSpec('not a repo')).toBeNull()
    expect(normalizeRepoSpec('a/b/c')).toBeNull()
    expect(normalizeRepoSpec('https://gitlab.com/a/b')).toBeNull()
    expect(normalizeRepoSpec('https://github.com/features/actions')).toBeNull()
  })
})

describe('splitRepo / repoPageUrl', () => {
  it('拆分 owner 与 repo', () => {
    expect(splitRepo('vuejs/core')).toEqual({ owner: 'vuejs', repo: 'core' })
  })

  it('没有斜杠时全部算 owner（防御性）', () => {
    expect(splitRepo('vuejs')).toEqual({ owner: 'vuejs', repo: '' })
  })

  it('仓库主页地址', () => {
    expect(repoPageUrl('vuejs/core')).toBe('https://github.com/vuejs/core')
  })
})

describe('compactNumber', () => {
  it('千 / 百万缩写', () => {
    expect(compactNumber(0)).toBe('0')
    expect(compactNumber(999)).toBe('999')
    expect(compactNumber(1234)).toBe('1.2k')
    expect(compactNumber(123_456)).toBe('123k')
    expect(compactNumber(1_234_567)).toBe('1.2M')
  })

  it('非法输入安全返回 0', () => {
    expect(compactNumber(Number.NaN)).toBe('0')
    expect(compactNumber(-5)).toBe('0')
    expect(compactNumber(Number.POSITIVE_INFINITY)).toBe('0')
  })
})

describe('daysSince', () => {
  const now = Date.parse('2026-10-26T00:00:00Z')

  it('整日差', () => {
    expect(daysSince('2026-10-26T00:00:00Z', now)).toBe(0)
    expect(daysSince('2026-10-25T00:00:00Z', now)).toBe(1)
    expect(daysSince('2026-10-16T00:00:00Z', now)).toBe(10)
  })

  it('未来时间（时钟回拨）返回 null', () => {
    expect(daysSince('2026-10-27T00:00:00Z', now)).toBeNull()
  })

  it('非法时间串返回 null', () => {
    expect(daysSince('不是时间', now)).toBeNull()
    expect(daysSince('', now)).toBeNull()
  })
})
