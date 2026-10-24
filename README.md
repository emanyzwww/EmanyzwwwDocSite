# EmanyzwwwDocSite

个人站点。VitePress 1.6.4 + TypeScript，完全自定义主题（不 extends 默认主题）。
中英双语（`/zh-cn/` + `/en/`），目录式 URL，明暗主题，站内搜索，RSS + sitemap。

```powershell
pnpm install     # 首次
pnpm dev         # 本地预览 → http://127.0.0.1:5173/
pnpm new         # 新建一篇文章（北京时间 + 当日序号 + 补全 frontmatter）
pnpm posts       # 列出文章（可带 20261024 只看某天）
pnpm build       # 构建到 .vitepress/dist
pnpm typecheck   # 类型检查
pnpm test        # 单测
pnpm format      # 格式化（内容 + 主题代码 + 脚本）
```

内容相关的全部命令：`new` / `posts` / `check` / `fix` / `stats` / `tags` / `clean`，
用 `pnpm help` 看总览，`pnpm <命令> --help` 看单个命令。

> 用 `pnpm posts` 而不是 `pnpm list`——`list` 是 pnpm 的内置命令，会先截获参数。

## 三份文档

| 文档                             | 讲什么                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------- |
| [DESIGN.md](./DESIGN.md)         | **设计系统**：配色、排版、圆角、阴影、间距、无障碍对比度。视觉改动的唯一准绳 |
| [WRITING.md](./WRITING.md)       | **写文章**：目录怎么摆、frontmatter 所有字段、图片、草稿、双语、标签、常见坑 |
| [DEVELOPING.md](./DEVELOPING.md) | **改代码**：组件/样式/数据/路由怎么组织，加功能删功能改哪里                  |

> 改任何视觉相关的东西之前先读 **DESIGN.md**。
> `theme/styles/tokens.css` 只是它的实现，不是规范本身。

## 技术栈

| 项     | 说明                                                  |
| ------ | ----------------------------------------------------- |
| 生成器 | VitePress 1.6.4（`cleanUrls: false`，目录式 URL）     |
| 语言   | TypeScript 5（strict）                                |
| 主题   | 自定义，见 `.vitepress/theme/`                        |
| 样式   | 三层设计令牌 + 深青强调色，见 `DESIGN.md`             |
| 搜索   | 构建期索引 + 纯前端匹配，零第三方依赖                 |
| 脚本   | `scripts/` + tsx，与构建期共用站点与 frontmatter 定义 |
| 格式化 | oxfmt（含 `.vue` / `.css` / `.ts`）                   |
| 部署   | GitHub Actions → GitHub Pages                         |

## 设计系统一览

| 维度     | 选择                                                        |
| -------- | ----------------------------------------------------------- |
| 强调色   | 深青 jade `#0f766e`（浅）/ `#4acdb4`（深）—— 全站唯一交互色 |
| 正文     | 17px / 行高 1.75 / 测量宽度 42rem（≈39 汉字/行）            |
| 字重     | 只用 400 / 600 / 700，刻意不用 500                          |
| 圆角     | 6 / 10 / 14 / 20 / 28 / pill 六档                           |
| 阴影     | 五级，但**卡片默认无阴影**——只给需要遮挡内容的浮层          |
| 层次策略 | 靠表面色差而不是边框或投影                                  |
| 滚动条   | 自绘（非原生）：6px 拇指、长度不低于页头、槽底与画布同色    |
| 无障碍   | 全部对比度实测，AA 以上（文字最低 5.00:1，控件最低 3.18:1） |

## 目录一览

```text
.vitepress/                 配置与主题（与内容分离）
├─ config.ts                路由 / Markdown / SEO / RSS / CSP
├─ data/                    站点信息、个人资料、侧栏卡片、搜索索引
├─ support/                 构建期工具（内容扫描、RSS、robots、dev 跳转）
└─ theme/                   运行期代码（组件、样式、文案、组合式函数）

docs/                       只有内容
├─ zh-cn/                   中文站 → /zh-cn/
│  ├─ index.md              首页
│  ├─ posts/                文章（每篇一个目录）
│  ├─ tags/                 标签总览 + 标签详情模板
│  └─ about/                关于
└─ en/                      英文站 → /en/（与 zh-cn 结构完全对应）

scripts/                    内容侧命令行（不参与构建）
├─ run.ts                   统一入口，按命令名分发
├─ new.ts / posts.ts        建文章 / 列文章
├─ check.ts / fix.ts        检查 / 自动修 frontmatter
├─ stats.ts / tags.ts       统计 / 标签清单
├─ clean.ts                 清理构建产物与缓存
└─ lib/                     共享内核：日期、frontmatter、路径、参数、输出

media/                      会替换的图片（自动指纹）
public/                     原样拷贝：favicon、根路径语言跳转页
```

根路径 `/` 不承载内容，按浏览器语言跳到 `/zh-cn/` 或 `/en/`（匹配不上时中文）。

## 移动端

手机不是「桌面的缩小版」，是另一套操作模型：页头在阅读时自动隐藏、
导航进抽屉、高频动作放悬浮胶囊（滚动收成圆）、目录从底部弹出、
搜索从顶部抽出。详见 `DEVELOPING.md` 的「移动端设计约定」一节。
