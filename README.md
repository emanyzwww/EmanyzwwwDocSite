# EmanyzwwwDocSite

个人站点。VitePress 1.6.4 + TypeScript，完全自定义主题（不 extends 默认主题）。
中英双语，目录式 URL，明暗主题，RSS + sitemap。

```powershell
pnpm install     # 首次
pnpm dev         # 本地预览 → http://127.0.0.1:5173/
pnpm build       # 构建到 docs/.vitepress/dist
pnpm typecheck   # 类型检查
pnpm format      # 格式化（含主题代码）
```

## 两份文档

| 文档                             | 讲什么                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------- |
| [WRITING.md](./WRITING.md)       | **写文章**：目录怎么摆、frontmatter 所有字段、图片、草稿、双语、标签、常见坑 |
| [DEVELOPING.md](./DEVELOPING.md) | **改代码**：组件/样式/数据/路由怎么组织，加功能删功能改哪里                  |

## 技术栈

| 项     | 说明                                              |
| ------ | ------------------------------------------------- |
| 生成器 | VitePress 1.6.4（`cleanUrls: false`，目录式 URL） |
| 语言   | TypeScript 5（strict）                            |
| 主题   | 自定义，见 `docs/.vitepress/theme/`               |
| 样式   | 三层设计令牌，见 `theme/styles/tokens.css`        |
| 格式化 | oxfmt（含 `.vue` / `.css` / `.ts`）               |
| 部署   | GitHub Actions → GitHub Pages                     |

## 目录一览

```text
docs/                       内容与主题
├─ index.md                 首页
├─ posts/                   文章（每篇一个目录）
├─ tags/                    标签总览 + 标签详情模板
├─ about/                   关于
├─ en/                      英文站（同构）
├─ media/                   会替换的图片（自动指纹）
├─ public/                  原样拷贝（favicon、robots.txt）
└─ .vitepress/              配置、数据、构建期工具、主题
```
