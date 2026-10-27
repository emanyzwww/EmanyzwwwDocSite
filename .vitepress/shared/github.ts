/**
 * GitHub 相关的**纯函数**（构建期与运行期共用）。
 *
 * 为什么单独放在 `shared/`：
 *
 * - `support/` 是构建期（Node），`theme/` 是运行期（浏览器）。这一层谁都不属于，
 *   所以**禁止** import `node:*` / `vite` / `vitepress` / `vue`，只做字符串与 URL 运算。
 * - 历史上这里是三份几乎相同的实现（构建期 `support/github-cards.ts`、
 *   浏览器层 `theme/support/link-preview/core.ts`、以及卡片渲染里再抄一遍
 *   `compactOf`），并且出现过 `support/` 反向 import `theme/` 的分层违规。
 *   现在只有这一份。
 */

/** 仓库引用（`owner/repo`）。 */
export interface GitHubRepoRef {
  /** 组织或个人用户名，保持原始大小写。 */
  owner: string
  /** 仓库名（已去掉 `.git` 后缀），保持原始大小写。 */
  repo: string
}

/**
 * `github.com` 下不是仓库的一级路径。
 *
 * 这些都是营销页或功能页，`/features/x` 之类的两段路径很容易被误判成仓库。
 */
const RESERVED_FIRST_SEGMENTS = new Set([
  'features',
  'security',
  'pricing',
  'marketplace',
  'topics',
  'collections',
  'trending',
  'sponsors',
  'settings',
  'notifications',
  'explore',
  'about',
  'contact',
  'search',
  'orgs',
  'enterprises',
  'account',
  'login',
  'join',
  'new',
  'apps',
  'codespaces',
])

/**
 * 从 URL 提取仓库信息。
 *
 * 接受的形态：
 * - `https://github.com/owner/repo`（仓库主页）
 * - 带任意子路径（`/issues`、`/blob/main/x`、`/pull/1`）——仍按 `owner/repo` 归
 * - 忽略 `gist.github.com`、`github.com/owner`（个人主页不是仓库）
 *
 * @returns `null` 表示不是仓库链接。
 */
export function parseGitHubRepo(url: string): GitHubRepoRef | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') return null

  const segments = parsed.pathname.split('/').filter(Boolean)
  // 至少 owner/repo 两段才是仓库；单段是个人主页
  if (segments.length < 2) return null

  const [owner, repo] = segments as [string, string]
  if (!owner || !repo) return null
  if (RESERVED_FIRST_SEGMENTS.has(owner.toLowerCase())) return null

  // clone 地址（`repo.git`）归一化掉后缀
  return { owner, repo: repo.replace(/\.git$/, '') }
}

/** `owner` 与 `repo` 的合法字符（GitHub 用户名与仓库名的并集，比实际宽松一点）。 */
const REPO_NAME = /^[A-Za-z0-9._-]+$/

/**
 * 把作者写的仓库标识归一化成 `owner/repo`。
 *
 * 接受两种写法，因为「参数里写短名」和「粘完整链接」都是自然习惯：
 * - `vuejs/core`
 * - `https://github.com/vuejs/core`（含子路径、`.git`、尾斜杠都行）
 *
 * @returns 归一化后的 `owner/repo`；无法识别时 `null`（由调用方报错）。
 */
export function normalizeRepoSpec(spec: string): string | null {
  const trimmed = spec.trim().replace(/^<|>$/g, '').replace(/\/+$/, '')
  if (!trimmed) return null

  if (/^https?:\/\//i.test(trimmed) || /^github\.com\//i.test(trimmed)) {
    const ref = parseGitHubRepo(/^github\.com\//i.test(trimmed) ? `https://${trimmed}` : trimmed)
    return ref ? `${ref.owner}/${ref.repo}` : null
  }

  const segments = trimmed.split('/').filter(Boolean)
  if (segments.length !== 2) return null
  const [owner, repo] = segments as [string, string]
  if (!REPO_NAME.test(owner) || !REPO_NAME.test(repo)) return null
  if (RESERVED_FIRST_SEGMENTS.has(owner.toLowerCase())) return null

  return `${owner}/${repo.replace(/\.git$/, '')}`
}

/** 仓库主页地址（基线与升级后都指向这里，保证链接语义为真）。 */
export function repoPageUrl(fullName: string): string {
  return `https://github.com/${fullName}`
}

/** 仓库名拆成 owner / repo 两段。无法拆分时 owner 为整串、repo 为空。 */
export function splitRepo(fullName: string): { owner: string; repo: string } {
  const index = fullName.indexOf('/')
  if (index === -1) return { owner: fullName, repo: '' }
  return { owner: fullName.slice(0, index), repo: fullName.slice(index + 1) }
}

/**
 * 数字缩写（`1234` → `1.2k`）。
 *
 * 规则：<1000 原样；k 与 M 一档，超过 100 不保留小数（`123k` 而不是 `123.4k`）。
 * 构建期与运行期共用这一份，避免同一仓库在卡片和悬浮卡里显示成两个数。
 */
export function compactNumber(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0'
  if (value < 1000) return String(Math.round(value))
  if (value < 1_000_000) {
    const k = value / 1000
    return `${k >= 100 ? Math.round(k) : Math.round(k * 10) / 10}k`
  }
  const m = value / 1_000_000
  return `${m >= 100 ? Math.round(m) : Math.round(m * 10) / 10}M`
}

/**
 * 距今整日数（用于「3 天前更新」这类相对时间）。
 *
 * 只返回数字，**不返回文案**：文案要走 i18n（构建期没有 i18n 上下文，
 * 而运行期有）。时钟回拨或时间串非法时返回 `null`，调用方就该不显示这一段。
 */
export function daysSince(iso: string, now: number): number | null {
  const timestamp = Date.parse(iso)
  if (!Number.isFinite(timestamp)) return null
  const days = Math.floor((now - timestamp) / 86_400_000)
  return days >= 0 ? days : null
}
