# EmanyzwwwDocSite

个人站点。VitePress 1.6.4 + TypeScript，完全自定义主题（不 extends 默认主题）。
中英双语（`/zh-cn/` + `/en/`），目录式 URL，明暗主题，RSS + sitemap。

```powershell
pnpm install     # 首次
pnpm dev         # 本地预览 → http://127.0.0.1:5173/
pnpm build       # 构建到 .vitepress/dist
pnpm typecheck   # 类型检查
pnpm format      # 格式化（内容 + 主题代码）
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
| 主题   | 自定义，见 `.vitepress/theme/`                    |
| 样式   | 三层设计令牌，见 `theme/styles/tokens.css`        |
| 格式化 | oxfmt（含 `.vue` / `.css` / `.ts`）               |
| 部署   | GitHub Actions → GitHub Pages                     |

## 目录一览

```text
.vitepress/                 配置与主题（与内容分离）
├─ config.ts                路由 / Markdown / SEO / RSS
├─ data/                    站点信息、个人资料、侧栏卡片
├─ support/                 构建期工具（内容扫描、RSS、robots、dev 跳转）
└─ theme/                   运行期代码（组件、样式、文案）

docs/                       只有内容与静态资源
├─ zh-cn/                   中文站 → /zh-cn/
│  ├─ index.md              首页
│  ├─ posts/                文章（每篇一个目录）
│  ├─ tags/                 标签总览 + 标签详情模板
│  └─ about/                关于
├─ en/                      英文站 → /en/（与 zh-cn 结构完全对应）
├─ media/                   会替换的图片（自动指纹）
└─ public/                  原样拷贝：favicon、根路径语言跳转页
```

根路径 `/` 不承载内容，按浏览器语言跳到 `/zh-cn/` 或 `/en/`（匹配不上时中文）。
