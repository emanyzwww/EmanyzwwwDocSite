#!/usr/bin/env node
//
// 站点格式化脚本
// ------------------------------------------------------------------
// 用 oxfmt（内置 Prettier 3.9 的 Markdown 插件）格式化：
//   - 内容：content 下的 Markdown
//   - 数据：data 下的 YAML
//   - 文档：README.md 等根级 Markdown
//   - 主题源码：assets/css、assets/js
//   - 配置：hugo.toml、package.json、i18n 下的 TOML
//
// 用法：
//   node scripts/format.js              格式化全部（就地写入）
//   node scripts/format.js --check      只检查，不写文件（CI 用）
//   node scripts/format.js content      只格式化指定目录/文件
//   node scripts/format.js --list       列出会被改动的文件
//   node scripts/format.js --dry        预览改动统计，不写入
//
// 永不触碰：
//   public、resources、node_modules、static、.git
//   （static 里是原样输出的资源，改了没有意义）
//
// 注意：不使用 JSDoc 块注释，避免 oxfmt 的 jsdoc 选项改写注释内容。
//

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

// 默认扫描的目录（存在才纳入）
// 注意不含 layouts：oxfmt 的 HTML 解析器无法处理 Hugo 模板里的
// 嵌套引号（如 aria-label 里再套双引号），实测会报 SyntaxError。
// 模板保持原样，也不应被自动改写空白。
const DEFAULT_TARGETS = ['content', 'data', 'assets', 'i18n', 'scripts']

// 根级单独文件
const ROOT_FILES = ['README.md', 'hugo.toml', 'package.json']

// 可格式化扩展名
const EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.yaml',
  '.yml',
  '.json',
  '.toml',
  '.css',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
])

// 永远跳过
const SKIP_DIRS = new Set([
  'public',
  'resources',
  'node_modules',
  '.git',
  '.idea',
  '.dsh',
  'static',
  'layouts',
])

// ---------------------------------------------------------------- //
// 参数解析
// ---------------------------------------------------------------- //

function parseArgs(argv) {
  const options = { check: false, list: false, dry: false, help: false, paths: [] }
  for (const arg of argv) {
    if (arg === '--check' || arg === '-c') options.check = true
    else if (arg === '--list' || arg === '-l') options.list = true
    else if (arg === '--dry' || arg === '-d') options.dry = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg.startsWith('-')) {
      console.error(`未知参数：${arg}`)
      process.exit(2)
    } else options.paths.push(arg)
  }
  return options
}

function printHelp() {
  console.log(`
站点格式化（oxfmt）

用法：
  node scripts/format.js            格式化全部
  node scripts/format.js --check    只检查
  node scripts/format.js --list     列出将被改动的文件
  node scripts/format.js --dry      预览，不写入
  node scripts/format.js content data       只处理指定路径

永不处理：public resources node_modules static layouts .git .dsh
`)
}

// ---------------------------------------------------------------- //
// 文件收集
// ---------------------------------------------------------------- //

function extname(file) {
  const base = file.split(/[\\/]/).pop()
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot).toLowerCase() : ''
}

function collectFiles(targetPath, out) {
  let stat
  try {
    stat = statSync(targetPath)
  } catch {
    return // 路径不存在，跳过
  }

  if (stat.isFile()) {
    if (EXTENSIONS.has(extname(targetPath))) out.push(targetPath)
    return
  }
  if (!stat.isDirectory()) return

  const name = targetPath.split(sep).pop()
  if (SKIP_DIRS.has(name)) return

  for (const entry of readdirSync(targetPath, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.gitignore') continue

    const full = join(targetPath, entry.name)
    if (entry.isDirectory()) collectFiles(full, out)
    else if (EXTENSIONS.has(extname(entry.name))) out.push(full)
  }
}

// ---------------------------------------------------------------- //
// 执行 oxfmt
// ---------------------------------------------------------------- //

function oxfmtBin() {
  const candidates = [
    join(ROOT, 'node_modules', 'oxfmt', 'bin', 'oxfmt'),
    join(ROOT, 'node_modules', '.bin', 'oxfmt'),
    join(ROOT, 'node_modules', '.bin', 'oxfmt.cmd'),
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
}

function run() {
  const options = parseArgs(process.argv.slice(2))

  if (options.help) {
    printHelp()
    return 0
  }

  // 确定范围
  const requested = options.paths.length ? options.paths : [...DEFAULT_TARGETS, ...ROOT_FILES]

  const files = []
  for (const p of requested) {
    collectFiles(resolve(ROOT, p), files)
  }

  // 去重 + 保证在工作区内
  const unique = [...new Set(files)].filter((f) => f.startsWith(ROOT + sep))

  if (unique.length === 0) {
    console.log('未找到可格式化的文件')
    return 0
  }

  const bin = oxfmtBin()
  if (!bin) {
    console.error('未找到 oxfmt，请先运行：pnpm install')
    return 1
  }

  // 组装 oxfmt 参数
  const args = [bin]
  if (options.check) args.push('--check')
  else if (options.list) args.push('--list-different')
  else if (!options.dry) args.push('--write')

  args.push('--no-error-on-unmatched-pattern')
  args.push('--ignore-path', '.oxfmtignore')
  args.push(...unique.map((f) => relative(ROOT, f)))

  const label = options.check ? '检查' : options.list ? '列出差异' : options.dry ? '预览' : '格式化'

  console.log(`[${label}] ${unique.length} 个文件\n`)

  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
  })

  if (result.error) {
    console.error('执行 oxfmt 失败：', result.error.message)
    return 1
  }

  return result.status ?? 0
}

process.exit(run())
