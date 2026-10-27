# EmanyzwwwDocSite

个人站点。VitePress 1.6.4 + TypeScript 5，完全自定义主题（不 extends 默认主题）。
中英双语（`/zh-cn/` + `/en/`）、目录式 URL、明暗主题、站内搜索（Ctrl/⌘+K）、
RSS + sitemap + 404 兜底；构建期零网络请求。

文章源文件固定为 `docs/<lang>/<YYYYMM>/<DDNN>/index.md`，URL 的标题段由
frontmatter 的 `slug` 决定，例如 `/zh-cn/202610/1901/你好，世界/`。

## 快速开始

```powershell
pnpm install     # 首次
pnpm dev         # 本地预览 → http://127.0.0.1:5173/
pnpm build       # 构建到 .vitepress/dist
pnpm preview     # 预览构建产物
```

内容侧命令（写文章用）：

```powershell
pnpm new         # 新建文章（北京时间 + 当日序号 + 补全 frontmatter）
pnpm posts       # 列出文章（可带 20261024 只看某天）
pnpm check       # 检查 frontmatter / 目录约定
pnpm fix         # 自动修正
pnpm stats       # 统计
pnpm tags        # 标签清单
pnpm clean       # 清理产物与缓存
pnpm guide       # 全部命令的总览
```

质量门禁：`pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm format:check`
（CI 在每次推送后按同一顺序跑，然后再 build）。

## 文档

| 文档                             | 讲什么                                                           |
| -------------------------------- | ---------------------------------------------------------------- |
| [DESIGN.md](./DESIGN.md)         | **设计系统**：配色、排版、圆角、阴影、动效、无障碍。视觉唯一准绳 |
| [WRITING.md](./WRITING.md)       | **写文章**：目录与 slug、frontmatter、图片、草稿、双语、标签、坑 |
| [DEVELOPING.md](./DEVELOPING.md) | **改代码**：目录职责、配置、图片管线、样式与组件、路由、部署     |

> 改视觉之前先读 **DESIGN.md**；`theme/styles/tokens.css` 只是它的实现。
> 写文章只读 **WRITING.md**；两处说法冲突时以代码与 DESIGN 为准并顺手修文档。

## Markdown 只有一层扩展

原生 CommonMark / GFM 原样渲染，普通链接**永远不会**被改写成卡片。本站独有的
只有两种长相：行内 `==高亮==`，与块级 `:::名称 … :::`。

块级指令共六个：`:::github` / `:::link` / `:::figure` / `:::quote` /
`:::columns` / `:::gallery`。逐条写法与参数见 WRITING.md 的「块级指令」一节。

**构建期零网络**：`:::github` 构建时只产出一条真链接，仓库数据由浏览器在卡片
进入视口时补充；取不到就保持链接。同样的源码永远得到同样的产物，断网也能构建
（`tests/offline-build.test.ts` 守着这条契约）。

## 技术栈

| 项     | 说明                                                            |
| ------ | --------------------------------------------------------------- |
| 生成器 | VitePress 1.6.4（`cleanUrls: false`，目录式 URL）               |
| 语言   | TypeScript 5（strict）                                          |
| 主题   | 自定义，见 `.vitepress/theme/`                                  |
| 样式   | 三层设计令牌 + 深青强调色，见 DESIGN.md                         |
| 搜索   | 构建期索引 + 纯前端匹配，零第三方依赖                           |
| 脚本   | `scripts/` + tsx，与构建期共用站点与 frontmatter 定义           |
| 校验   | oxlint / vue-tsc / vitest（450 用例）/ oxfmt                    |
| 部署   | GitHub Actions → GitHub Pages（质量门禁 + 部署后 sitemap 冒烟） |

无障碍：全部文字与控件对比度按 WCAG 公式实算，AA 以上；完整表见 DESIGN.md §9.1。

## 目录

```text
.vitepress/    配置（config.ts）+ 构建期工具（support/、shared/、data/）+ 运行期主题（theme/）
docs/          内容：<lang>/index.md（首页）、<lang>/<YYYYMM>/<DDNN>/、<lang>/pages/
scripts/       内容侧命令行（不参与构建）：run.ts + new/posts/check/fix/stats/tags/clean
media/         会替换的图片（按内容指纹命名）
public/        原样拷贝：favicon、根路径语言跳转页、占位图
```

完整目录树、每层职责与「加/删功能改哪里」见 [DEVELOPING.md](./DEVELOPING.md)。

根路径 `/` 不承载内容，按浏览器语言跳到 `/zh-cn/` 或 `/en/`（匹配不上时中文）。

## 移动端

手机是另一套操作模型：页头在阅读时自动隐藏、导航进抽屉、高频动作放悬浮胶囊、
目录从底部弹出、搜索从顶部抽出。实现与坑见 DEVELOPING.md 的「移动端」一节，
视觉规范见 DESIGN.md 的动效与层级章节。
