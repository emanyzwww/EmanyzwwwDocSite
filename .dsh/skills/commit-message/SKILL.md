---
name: commit-message
description: "为 VitePress 静态站点生成中文提交词（Conventional Commits）；scope 贴合 docs/theme/data/support 等真实目录，可限定或排除路径。"
whenToUse: "用户要求生成 commit message、提交信息、提交词、提交说明，或说「帮我提交」时使用。"
---

# 提交词生成

唯一产物：**一个 `text` 代码块内的中文提交词**。
不提交、不改文件、不解释。

## 环境

命令一律用 **PowerShell 7+（`pwsh`，Core 版）** 执行，本机为 `C:\Program Files\PowerShell\7\pwsh.exe`（7.6.5）。

- **不要用** Windows PowerShell 5.1（`powershell.exe`，灰色控制台那个）
- **不要写** `powershell -Command "..."` 或 `cmd /c`
- 命令直接写 PowerShell 语法即可，无需为了兼容性降级写法：
  - 三目运算符 `? :`、`??`、`?.` 可用
  - `&&`、`||` 串联可用
  - `$PSVersionTable.PSVersion`、`Get-ChildItem -File` 等 Core 特性可用
- 需要显式调用时：

```powershell
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoProfile -Command '<命令>'
```

## 1. 输出格式

```text
<type>(<scope>): <主题>

- <要点 1>
- <要点 2>
```

铁律：

- 代码块**外**不写任何字（三种「只回一句」情形除外，见下）
- 只输出中文
- 主题行 ≤ 50 字，**结尾不加标点**
- 每条要点以 `- ` 开头，**结尾不加句号**
- 至少 1 条要点；一件事一条，不合并无关变更
- 中文与数字、英文专名之间留一个半角空格
- 文件名、标识符保持原文：`assets/css/tokens.css`

### 只回一句的三种情形

| 情形 | 唯一输出 |
|---|---|
| `git rev-parse --is-inside-work-tree` 失败 | `当前目录不是 Git 仓库` |
| 范围内没有变更 | `未检测到任何变更` |
| 用户本轮明确要求英文 | 英文版（仅此一次，不与中文混排） |

## 2. 流程

### 步骤 1 · 确认仓库

```powershell
git rev-parse --is-inside-work-tree
```

失败即结束，按上表回一句。

### 步骤 2 · 取变更清单

```powershell
git rev-parse --verify HEAD
```

| 结果 | 说明 | 下一步 |
|---|---|---|
| 成功 | 已有提交 | `git diff HEAD --name-only` |
| 报错 | **尚无提交** | `git status --porcelain` |

### 步骤 3 · 逐个读取（最易出错，务必照做）

对清单中**每一个**文件读取实际内容：

| 仓库状态 | 文件的 `git status` 标记 | 读取方式 |
|---|---|---|
| 已有提交 | 任意 | `git diff HEAD -- <file>` |
| 尚无提交 | `A `（已暂存新文件） | **直接读文件原文** |
| 尚无提交 | `??`（未跟踪） | **直接读文件原文** |
| 尚无提交 | ` M`（已修改） | `git diff -- <file>` |

三条必须遵守：

1. 无提交时 `git diff HEAD` 必然报错，**不要反复尝试**
2. `A ` 与 `??` 在 `git diff` 中**看不到任何内容**，只能读原文
3. 输出被截断就继续读；**不许跳过文件，不许凭文件名猜内容**

## 3. 字段规则

### type

唯一可用值：

`feat` `fix` `docs` `style` `refactor` `perf` `test` `build` `ci` `chore` `revert`

本项目对照表：

| 改动内容 | type |
|---|---|
| 写文章、改正文、补页面文字 | `docs` |
| 新增页面类型、组件、功能（如新的侧栏卡片） | `feat` |
| 修复渲染报错、样式错位、链接失效 | `fix` |
| 只改配色、间距、字号，行为不变 | `style` |
| 重构组件、拆分 composable、CSS 变量化 | `refactor` |
| `base`、`sitemap`、`postsPerPage` 等构建配置 | `build` |
| 依赖、工具脚本、技能配置 | `chore` |
| CI/CD 流水线 | `ci` |
| 撤销先前提交 | `revert` |

多类改动并存时取**占主导的一个**，不用并列 type。

### scope

只用本项目真实目录，不自造（本项目是 **VitePress**，不是 Hugo）：

| 路径 | scope |
|---|---|
| `docs/`（文章、页面、`*.paths.ts`） | `content` |
| `.vitepress/theme/`（组件、样式、文案） | `theme` |
| `.vitepress/data/`（站点信息、个人资料、侧栏卡片） | `data` |
| `.vitepress/support/`（内容扫描、RSS、robots、dev 跳转） | `support` |
| `.vitepress/config.ts`、`tsconfig.json`、`package.json` | `config` |
| `public/`、`media/`（静态资源与图片） | `assets` |
| `tests/` | `test` |
| `README.md`、`WRITING.md`、`DEVELOPING.md` | `docs` |
| `.github/` | `ci` |
| `.dsh/`、`.gitignore`、`.oxfmtrc.json`、`.oxlintrc.json`、`vitest.config.ts` | `chore` |

- 主次分明时取主要一方；确实并列则用半角逗号：`theme,content`
- 无法归入以上任一项时用 `root`

### 主题

必须以动词开头：

`新增` / `修复` / `重构` / `优化` / `调整` / `删除` / `升级` / `迁移` / `补充` / `改进`

### 要点

- 一件事一条，写清改了什么
- 同一逻辑改动涉及多个文件时合并成一条（如一次主题改动同时动了 `.vitepress/theme/components/` 与 `.vitepress/theme/styles/`）
- **双语成对合并**：`docs/zh-cn/` 与 `docs/en/` 下同一相对路径的两个文件属于同一篇文章，合并成一条要点
- 只改了一种语言就如实写单语，不臆造另一种也改了
- 新增文章写「新增文章《标题》及英文版本」

### 可选附加行

仅在有实际依据时使用，否则不写：

```text
BREAKING CHANGE: <说明>
```

```text
Refs: #12
```

或 `Closes: #12`（仅在用户给出 issue 号时）

## 4. 分析范围

默认分析全部变更。用户限定范围时：

| 用户表达 | 范围 |
|---|---|
| 「只看 X」「根据 X」 | 仅 X |
| 「排除 Y」「Y 除外」 | 除 Y 外全部 |
| 多个路径 | 取并集 |

```powershell
git diff HEAD -- <path>
git status --porcelain -- <path>
git diff HEAD -- . ':(exclude)<path>'
```

多个路径分别指定，不用通配符猜范围。

## 5. 永不分析的路径

`.vitepress/dist/`、`.vitepress/cache/`、`.vitepress/.temp/`、`node_modules/`、`.idea/`

这些是构建产物、缓存或本地配置，已列入 `.gitignore`。即使出现在 `git status --porcelain --ignored` 里，也**不读、不写进提交词**。

`public/` 与 `media/` 是**受版本控制的源文件**（favicon、根路径跳转页、头像），
它们的改动照常分析，不要当成构建产物跳过。

## 6. 常见错误对照

| 错误 | 正确 |
|---|---|
| 代码块外加「已按规范生成」之类的话 | 只留代码块 |
| 把 `docs/zh-cn/x` 与 `docs/en/x` 拆成两条要点 | 合并成一条 |
| 无提交时用 `git diff` 读新文件，读到空就凭文件名猜 | 直接读文件原文 |
| 自造 scope（`blog`、`site`、`web`） | 用第 3 节表中的真实目录名 |
| 主题行或要点结尾加句号 | 一律不加 |
| 把 `public/` 的变动写进要点 | 完全忽略 |
| 一条要点里塞三件无关的事 | 拆成一事一条 |
| 输出分析过程、范围说明、客套话 | 不输出 |
| 用 `powershell.exe`（5.1）或 `cmd /c` 执行命令 | 用 `pwsh`（7+） |
| 在 5.1 里跑 `gh`/`&` 串联命令，报错或读到空 | 换 `pwsh` 执行 |

## 7. 硬性禁止

绝不执行：

`git add` `git commit` `git push` `git reset` `git checkout` `git stash` `git revert`

绝不：

- 创建、修改、删除、重命名任何项目文件
- 把范围外或生成物的内容写进提交词
- 用猜测代替实际读取
- 输出代码块以外的说明文字
