# 代码维护指南

**这份文档只讲一件事：怎么改代码。** 设计系统请读 [DESIGN.md](./DESIGN.md)，
写作请读 [WRITING.md](./WRITING.md)。

> **改任何视觉相关的东西之前，先读 [DESIGN.md](./DESIGN.md)。**
> 那里是配色、排版、圆角、阴影、间距的**唯一准绳**；
> `theme/styles/tokens.css` 只是它的实现。本文档负责「改哪儿」，
> DESIGN.md 负责「为什么是这样」。

目录：[心智模型](#一心智模型一次构建发生了什么) · [目录职责](#二目录职责表) ·
[配置](#三改站点配置) · [图片管线](#三五图片管线与内容增强) · [样式](#四改样式) ·
[组件](#五改组件) · [标签与路由](#六标签与路由) ·
[加功能](#七加功能任务清单) / [删功能](#八删功能反向操作) ·
[检查测试](#九检查测试与格式化) · [部署](#十部署) ·
[附：决策](#附设计决策速查) / [移动端](#附移动端设计约定) /
[进度条与滚动条](#附阅读进度条滚动锁与自绘滚动条)

---

## 一、心智模型：一次构建发生了什么

理解这条链路，绝大多数「该改哪儿」的问题就不用查文档了。

```text
docs/{zh-cn,en}/                       ← 内容按语言分目录，URL 前缀即目录名
├─ <YYYYMM>/<DDNN>/index.md            ← 文章：目录只表达「年月 / 日+序号」
└─ pages/**/index.md                   ← 非文章页（about / 文章列表 / 标签）
    │
    │  ① support/content.ts 扫描 .md、解析 frontmatter
    │     article-path / slug / translation 算 URL 段与跨语言配对键
    ▼
data/{posts,search,pages}.data.ts  ──►  摘要数组 / 搜索索引 / 页面 URL 索引
    │                                   （构建期算好，内联进客户端 chunk）
    │  ② docs/<locale>/pages/{tags,posts}/**/index.paths.ts 生成动态路由
    ▼
config.ts
    │  ③ rewrites 补 slug 段；transformPageData 补标题；transformHead 补 SEO
    │  ③.4 support/markdown/：applySiteMarkdown 装行内 / 指令 / 代码块头部（渲染时执行）
    │  ③.5 support/media/：buildStart 预扫转码 → mediaMarkdown 渲染 srcset
    │     → generateBundle emitFile；dev 走中间件
    │  ③.6 transformHtml 收集已渲染正文 → support/rendered.ts（给 RSS）
    ▼
theme/Layout.vue
    │  ④ 按 frontmatter.layout 选页面组件；PageShell 挂载跨页面能力
    ▼
Vue 组件 ──► HTML（图片已是 <figure>，点击由 useImageViewer 接管）
    │  ⑤ buildEnd 写 RSS / robots / 404 兜底
    ▼
.vitepress/dist/
```

**四条重要结论**：

1. **文章数据只有一个来源**：`support/content.ts`。列表、标签、RSS、统计卡、搜索索引
   看到的是同一份，不会出现「列表里有、标签页没有」。
2. **`support/` 是构建期、`theme/` 是运行期、`shared/` 两边共用**。前者能 `import 'node:fs'`，
   后两者不能；纯函数放 `shared/`。
3. **构建期只产出静态、可复现的字节**：图片、RSS、robots、404 兜底都在构建期写死；
   GitHub 卡片等动态数据一律由浏览器补（构建期零网络）。
4. **数据在构建期算好，客户端零计算**。加字段要改 `types.ts` + `content.ts`，不是改组件。

---

## 二、目录职责表

```text
.vitepress/                 ← 配置与主题在仓库根，与内容分离
├─ config.ts              构建配置：路由、Markdown、SEO、RSS、CSP。改「站点行为」看这里
├─ types.ts               全站类型。加字段先改这里，TS 会告诉你哪儿还没适配
│
├─ data/                  纯数据与数据加载器（*.data.ts 是构建期加载器）
│  ├─ site.ts             ★ 站点名、域名、导航、页脚、分页数、侧栏顺序、语言表
│  ├─ profile.ts          ★ 个人信息、头像、社交链接
│  ├─ taxonomy.ts         标签 slug / 显示名覆盖（可选）
│  ├─ posts.data.ts       → 文章摘要数组（PostSummary[]）
│  ├─ pages.data.ts       → 全部内容页路径（语言切换用）
│  ├─ profile.data.ts     → 渲染好的 bio HTML
│  └─ search.data.ts      → 搜索索引（见第五节「搜索」）
│
├─ shared/                 ★ 构建期与运行期共用的纯函数（禁止 Node / Vue / Vite）
│  ├─ github.ts           GitHub URL 解析、repo 名归一化、数字缩写、相对天数
│  └─ icons.ts            ★ 图标表 ICONS / getIcon / renderIcon（构建期拼 SVG，运行期供 AppIcon）
│
├─ support/               构建期 Node 工具（不能在浏览器里跑）
│  ├─ content.ts          ★ 扫描/解析 Markdown，文章的唯一定义处
│  ├─ article-path.ts     ★ 文章路径身份（`<YYYYMM>/<DDNN>`）与 route 拼接
│  ├─ slug.ts             ★ slug 规则（含中文保留原字 / 纯拉丁 kebab-case）
│  ├─ translation.ts      跨语言配对（显式 translationKey > `<YYYYMM>/<DDNN>`）
│  ├─ urls.ts / locale-paths.ts   路径与语言前缀换算（纯函数，不 import vitepress）
│  ├─ format.ts           日期/字数/截断（纯函数，两端通用）
│  ├─ markdown/           ★ Markdown 装配点（见「块级指令」与「代码块管线」）
│  │  ├─ index.ts         applySiteMarkdown()：页面正文与非页面共用同一套插件
│  │  ├─ code-theme.ts    ★ 代码块双主题色板：Shiki 配色的唯一来源（含对比度契约）
│  │  ├─ code-blocks.ts   ★ 代码块头部注入：`[路径]` 解析、语言推断、DOM 契约
│  │  └─ directives/      registry（注册表/报错）、parse、block、images、builtins（六个指令）
│  ├─ markdown-plugins.ts 自写行内语法：`==高亮==`、GFM 任务列表
│  ├─ media/              ★ 图片管线
│  │  ├─ planner.ts       纯函数：格式裁决、档位、命名、base 拼接（可单测）
│  │  ├─ probe.ts         同步读图片头部尺寸（零依赖，可单测）
│  │  ├─ registry.ts      源路径 → 产物清单；sha256 去重；按需转码
│  │  ├─ transcode.ts     唯一 import sharp 的文件；磁盘缓存 + LQIP
│  │  ├─ render.ts        markdown 侧：figure 提升 + 图片渲染
│  │  ├─ runtime.ts       运行期上下文单例（base / 模式 / 目录）
│  │  └─ vite.ts          Vite 插件：预扫 / emitFile / dev 中间件
│  ├─ rendered.ts         收集 transformHtml 阶段的正文（给 RSS 用）
│  ├─ rss.ts              RSS 生成（buildEnd 调用，含 content:encoded）
│  ├─ feed-code.ts        RSS 代码块清洗：网页专用头部 / 按钮 / tab 条 → feed-safe
│  ├─ robots.ts           robots.txt 生成（buildEnd 调用）
│  ├─ not-found.ts        404 页无 JS 兜底（buildEnd 调用）
│  └─ dev-redirect.ts     dev 下 `/` 按 Accept-Language 跳语言
│
├─ dist/                  构建产物（gitignore）
├─ cache/                 Vite 依赖缓存 + 图片转码缓存（gitignore）
│
└─ theme/                 运行期代码（浏览器）
   ├─ index.ts            主题入口：样式 + 路由过渡 + 锚点滚动 + 嵌入块增强 + 复制按钮本地化
   ├─ Layout.vue          ★ 按 frontmatter.layout / isNotFound 分发页面组件
   ├─ i18n/               界面文案（zh-cn / en / index）
   ├─ composables/        12 个组合式函数（见第五节）
   ├─ components/         38 个 .vue，按职责分 8 个目录
   │  ├─ pages/           六个页面级组件（Home/Posts/Doc/Tags/Tag/NotFound）
   │  ├─ layout/          外壳：PageShell、TwoColumn、ThreeColumn
   │  ├─ site/            页头、页脚、导航、搜索面板、主题切换、语言切换
   │  ├─ mobile/          移动端专属：导航抽屉（MobileNav）、悬浮胶囊（MobileDock）
   │  ├─ post/            文章卡片、时间线、元信息、上下篇、分页
   │  ├─ tag/             标签云、标签分组、其他标签
   │  ├─ aside/           容器 + 5 张卡（注册表里只有 profile/tags 两张，其余由页面直接挂）
   │  └─ common/          图标、空状态、进度条、滚动条、查看器、链接预览卡
   ├─ embeds/enhance.ts   `:::github` 等嵌入块的运行期增强（EmbedEnhancer）
   ├─ support/            浏览器侧工具（见下方「三类 support 与 shared」）
   │  └─ link-preview/    core（纯函数）+ providers（provider 注册表）
   └─ styles/             14 个样式文件（tokens + 12 个分层 + index 入口，见第四节）

docs/                      ← 只有内容
├─ zh-cn/                 中文站（URL `/zh-cn/`）
│  ├─ index.md            首页（layout: home）
│  ├─ 202610/             年月目录（YYYYMM）
│  │  ├─ 1901/index.md    19 日第 01 篇（配图与 index.md 同目录）
│  │  └─ 2601/index.md    26 日第 01 篇（当前是 frontmatter 里的草稿）
│  ├─ _drafts/            草稿目录（可选；当前没有；不参与构建）
│  └─ pages/              非文章页面
│     ├─ about/index.md                   → /zh-cn/pages/about/
│     ├─ posts/index.md                   → /zh-cn/pages/posts/（列表第 1 页）
│     ├─ posts/page/[page]/index.md       分页模板 + index.paths.ts（第 2 页起）
│     ├─ tags/index.md                    → /zh-cn/pages/tags/（标签总览）
│     └─ tags/[tag]/index.md              标签模板 + index.paths.ts
└─ en/                    英文站（URL `/en/`），结构完全对应

scripts/                   ← 命令行脚本（内容侧工具，不参与构建）
├─ run.ts                 统一入口：按命令名分发，提供统一的参数与错误出口
├─ new.ts                 pnpm new    新建文章（北京时间 + 当日序号 + 补全 frontmatter）
├─ posts.ts               pnpm posts  列出文章（按日期 / 语言 / 标签）
├─ check.ts               pnpm check  检查 frontmatter 与路径规范
├─ fix.ts                 pnpm fix    自动修可修的项（排序、补字段、日期规范化）
├─ stats.ts               pnpm stats  统计文章数 / 字数 / 分布
├─ tags.ts                pnpm tags   标签及文章数
├─ clean.ts               pnpm clean  清理构建产物与缓存
└─ lib/                   共享内核（纯函数，可单测）
   ├─ site.ts             仓库路径、语言表、时区（从 .vitepress 再导出）
   ├─ dates.ts            北京时间的日期换算与 ISO 序列化
   ├─ frontmatter-schema.ts ★ frontmatter 字段表（唯一事实来源）
   ├─ frontmatter.ts      frontmatter 的解析与序列化（保持仓库写作风格）
   ├─ posts.ts            文章路径解析与收集（`<YYYYMM>/<DDNN>/`）
   ├─ create.ts           建目录、分配序号、写 frontmatter（含自动推导的 slug）
   ├─ args.ts             命令行参数解析
   └─ ui.ts               颜色、按显示宽度对齐、表格

tests/                    26 个 *.test.ts + fixtures/tiny.png（见第九节）
.github/                  workflows/deploy.yml（构建 + 门禁 + 部署 + 冒烟）、dependabot.yml（action 升级）

media/                     ← 会换的图（头像等），走 Vite 指纹
public/                    ← 原样拷贝：favicon、根路径语言跳转页
.gitattributes             统一行尾 LF（见「加一个 npm 脚本」后的 fix 边界）
```

带 ★ 的是**日常最常改的**。IDE / AI 辅助目录（`.idea/`、`.vscode/`、`.dsh/`）未列出。

> `.vitepress` 在仓库根而不是 `docs/` 里，因此 `config.ts` 必须显式声明
> `srcDir: 'docs'`、`outDir: '.vitepress/dist'`、`cacheDir: '.vitepress/cache'`。
> 否则 VitePress 会按命令行传入的 root（`.`）解析成 `./dist`、`./cache`。
>
> `public/` 同理：Vite 的 `publicDir` 相对 root（= `srcDir`）解析，默认会去找
> `docs/public`。因此配置里用**绝对路径**指向仓库根的 `public/`，
> 否则 favicon 与根路径跳转页都不会进产物。

### 文章身份：`article-path.ts` + `slug.ts` + `rewrites`

重构后「一篇文章」横跨三处，动其中一处时必须同时想到另两处：

| 位置                                              | 负责什么                                                                             | 改什么会牵动它                  |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------- |
| `docs/<lang>/<YYYYMM>/<DDNN>/index.md`            | 文章源文件的唯一形态（`202610/1901` = 2026 年 10 月 19 日第 01 篇）                  | 新增 / 删除文章、改日期目录     |
| frontmatter 的 `slug` → `config.ts` 的 `rewrites` | URL 的标题段，拼成 `/<lang>/<YYYYMM>/<DDNN>/<slug>/`，映射在构建期生成               | 新增文章、改 slug 后 dev 需重启 |
| `support/article-path.ts` + `support/slug.ts`     | 路径身份与 slug 规则的**唯一实现**，`content.ts` / `config.ts` / `scripts/` 都复用它 | 改命名规则、加语言              |

1. **文章源文件**：`docs/<lang>/<YYYYMM>/<DDNN>/index.md`。目录里**没有标题**，标题只在
   frontmatter 的 `title`；目录名只表达「哪个月、哪天、当天第几篇」。
2. **URL 的 slug 段**：来自 frontmatter `slug`（省略时由 `title` 推导），由 `config.ts`
   的 `rewrites` 在构建期映射成真实路由。因此新增文章或改 `slug` 后，运行中的
   `pnpm dev` 不会自己发现——需要重启；`pnpm build` 每次都重新映射，不受影响。
3. **唯一实现**：`support/article-path.ts`（解析目录身份、拼出 route 路径）与
   `support/slug.ts`（由标题推导 slug、判断 slug 是否可用）是唯一实现。`support/content.ts`
   （站点数据）、`config.ts`（rewrites / hreflang）与 `scripts/lib/*`（命令行）都调用它，
   不要再各写一份正则。

两个文件的分工：`article-path.ts` 只回答「这篇文章在磁盘上的身份是什么」，
`slug.ts` 只回答「URL 的标题段是什么」；「相对路径 → 站内 URL」的通用换算仍在
`support/urls.ts`。

### 三类 `support/`、`shared/` 与 `scripts/lib/`（容易混）

|                | `.vitepress/support/`                  | `.vitepress/shared/`        | `.vitepress/theme/support/` | `scripts/lib/`             |
| -------------- | -------------------------------------- | --------------------------- | --------------------------- | -------------------------- |
| 运行环境       | 构建期（Node）                         | 两边都能用                  | 浏览器                      | 命令行（Node）             |
| 能用 `node:fs` | ✅                                     | ❌                          | ❌                          | ✅                         |
| 典型内容       | 读文件、RSS、图片管线                  | github.ts / icons.ts 纯函数 | 路径拼接、浮层、滚动、媒体  | 参数解析、建文章、终端输出 |
| 被谁引用       | `config.ts`、`*.data.ts`、`*.paths.ts` | `support/` 与 `theme/` 均可 | Vue 组件                    | `scripts/*.ts`             |

例外：`format.ts` 在构建期目录里，但它是纯函数，两边都能用。

**脚本为什么不自己定义一套站点常量**：语言的权威定义在 `.vitepress/data/site.ts`，
frontmatter 字段的权威定义在 `scripts/lib/frontmatter-schema.ts`。
`scripts/lib/site.ts` 只把前者**再导出**给命令行用，一个字都不复制——
否则加一门语言、加一个 frontmatter 字段时，构建期与命令行会各说各话。

`shared/` 是这一轮新拆出来的一层：它存在的唯一理由是「构建期与运行期都要用，
但两边都不能依赖对方」。所以这一层**禁止** import `node:*` / `vite` / `vitepress` / `vue`。
`theme/support/link-preview/core.ts` 里的 `parseGitHubRepo` / `compactNumber`
现在只是从 `shared/github.ts` 再导出，不要再在本文件里重写一份。

### 已被删除的旧入口（别再去翻）

| 旧路径 / 旧符号                                                       | 现状                                             |
| --------------------------------------------------------------------- | ------------------------------------------------ |
| `.vitepress/data/widgets.ts`、`widgets.data.ts`                       | 已删。侧栏没有「纯文本卡片」，只有注册表里的两张 |
| `theme/components/aside/WidgetsCard.vue`、`LinksCard.vue`             | 已删                                             |
| `theme/support/icons.ts`（兼容层）                                    | 已删，`shared/icons.ts` 是唯一图标表             |
| `.vitepress/data/frontmatter.ts`                                      | 移到 `scripts/lib/frontmatter-schema.ts`         |
| `scripts/lib/site.ts` 的 `articleRootDir` / `pagesDir` / `localeMeta` | 已删；目录与语言从 `.vitepress` 再导出           |
| `package.json` 的 `list` 别名                                         | 已删；列文章用 `pnpm posts`，总览用 `pnpm guide` |

本轮还清掉了一批死符号（`repoDisplayTitle`、`stripLocalePrefix`、`clearContentCache`、
`clearRenderedContent`、`referencedSources`、`assertReadable`、`resetLightboxState`、
`resetLinkPreviewState`、`EmbedEnhancer.dispose`、`NavItem`、`LocaleMeta.code`、
`FooterConfig.text`、`PostSummary.filePath` / `draft`、`Messages.links` / `draft` /
`imageViewerFit`）。**旧文档提到它们的段落已全部删除**；如果你在别处还看到这些名字，
那份材料已经过期。

---

## 三、改站点配置

### `data/site.ts` —— 站点层面的一切

```ts
export const SITE: SiteMeta = {
  url: 'https://emanyzwww.github.io', // 站点 origin（sitemap / RSS 用）
  name: 'EmanyzwwwDocSite', // 品牌名（页头 / 页脚 / 标题后缀）
  timeZone: 'Asia/Shanghai', // 日期显示时区
  postsPerPage: 10,
  homePostCount: 5,
  recentPostsLimit: 5,
  tagSuggestLimit: 20,
  tagPreviewCount: 3,
  outline: true, // 全站目录开关
  wordCount: true, // 全站字数开关
  widgets: ['profile', 'tags'], // 侧栏卡片顺序（只有这两张）
  footer: {/* copyright 留空自动生成；links 是页脚链接 */},
}
```

> `SITE_URL` 必须是**真实可访问**的 origin：sitemap、canonical、RSS 的绝对链接
> 全部由它派生；部署子路径只写 origin，子路径由 `base` 单独处理。
>
> `widgets` 的类型是 `WidgetName[]`（当前只有 `'profile' | 'tags'`），写错名字会在
> `pnpm typecheck` 报错。其余字段（`since`、`footer.links`、`NAV`、`LOCALES`、
> `DEFAULT_LOCALE`）都是自解释的，改完直接看页面即可。

### 语言模型（`zh-cn` / `en` 完全对等）

`LocaleCode = 'zh-cn' | 'en'`，两个值同时是：

| 身份           | 例子                                     |
| -------------- | ---------------------------------------- |
| 内容目录名     | `docs/zh-cn/`、`docs/en/`                |
| URL 前缀       | `/zh-cn/`、`/en/`                        |
| `locales` 的键 | `locales: { 'zh-cn': {...}, en: {...} }` |
| `LOCALES` 的键 | `LOCALES['zh-cn']`、`LOCALES.en`         |

没有「默认语言不带前缀」的特例。新增语言就是三件事：
加 `docs/<code>/` 目录、加 `LOCALES` 一条、加 `locales` 一段（外加 `theme/i18n/` 一份文案）。

**根路径 `/` 不承载内容**：`public/index.html` 按浏览器语言跳到 `/zh-cn/` 或 `/en/`，
匹配不上时落到 `DEFAULT_LOCALE`；手动选过的语言记在 `localStorage`（键
`emanyzwww-locale`）且优先级更高。dev 阶段由 `support/dev-redirect.ts` 用
`Accept-Language` 做同样的跳转。

### 改导航

```ts
export const NAV = {
  'zh-cn': [
    { text: '首页', link: '/zh-cn/' },
    { text: '文章', link: '/zh-cn/pages/posts/' },
    // 标签 / 关于 同理
  ],
  en: [/* 英文版，必须分别加 */],
}
```

- `link` 用**目录式路径**（`/zh-cn/pages/posts/`），不要写 `.html`，不要写相对路径
- 两种语言的 link 都必须带各自的语言前缀，与 `docs/<locale>/` 目录一一对应
- 高亮自动判断：当前路径等于该项或以该项为前缀；首页只做精确匹配

### `data/profile.ts` —— 个人信息

`PROFILE` 只有头像文件名（`media/` 下）、名字、tagline、支持 Markdown 的 `bio`、
社交 `links`（`icon` 可选值见 `IconName`）与 `tagsLimit`。头像通过 `media/` 的资源导入
拿到带指纹的 URL；加新图标要改 `shared/icons.ts`（见第五节）。

### `config.ts` —— 构建行为

| 想改               | 位置                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| 代码高亮主题       | `markdown.theme`（`CODE_THEMES`：本站自有 `jade-light` / `jade-dark` 双主题，见「代码块管线」） |
| 目录收几级标题     | `markdown.headers.level`（当前 `[2, 3]`，可加 4）                                               |
| 草稿目录           | `srcExclude`（当前含 `**/_drafts/**` 与 `**/README.md`）                                        |
| 文章 URL 映射      | `rewrites`（`<YYYYMM>/<DDNN>/index.md` → 带 slug 的 route，复用 `support/article-path.ts`）     |
| 锚点跳转偏移       | `scrollOffset`（当前 80；仅影响跨页 hash 定位，页内滚动读 `scroll-padding-top`）                |
| 站点地图域名       | `sitemap.hostname`（= 站点 origin + `VP_BASE`）                                                 |
| 页头 meta          | `head` 数组（viewport、CSP、referrer、favicon）                                                 |
| 页面标题怎么拼     | `transformPageData`                                                                             |
| OG / RSS / 互指    | `transformHead`                                                                                 |
| RSS / robots / 404 | `buildEnd` → `support/rss.ts` / `robots.ts` / `not-found.ts`                                    |
| RSS 正文           | `transformHtml` → `support/rendered.ts` 收集已渲染正文                                          |

### 部署路径与环境变量

`config.ts` 里两个环境变量：

```ts
const BASE = process.env.VP_BASE ?? '/' // 部署根路径
const SITE_URL = (process.env.VP_SITE_URL ?? SITE.url).replace(/\/$/, '')
const SITEMAP_HOSTNAME = new URL(BASE, new URL(SITE_URL).origin).href
```

CI 会自动算好这两个值传给构建（见 `.github/workflows/deploy.yml`）。本地不用管。

**坑：sitemap 的 `hostname` 必须包含 `BASE`。** VitePress 用
`new URL(page.url, hostname)` 拼绝对地址，而 `page.url` 是 `zh-cn/pages/about/` 这类相对路径；
若 `hostname` 只有 origin，`/repo/` 会被 URL 解析吃掉，项目站点的 sitemap 会全部
指向域名根。`SITEMAP_HOSTNAME` 就是为此存在的，`robots.txt` 也复用它。

### CSP 与安全 meta

GitHub Pages 不允许自定义响应头，因此 CSP / Referrer-Policy 只能靠 `head` 里的 `<meta>` 补齐：
`referrer: strict-origin-when-cross-origin`（外链只带 origin）；CSP 中
`script-src 'self' 'unsafe-inline'` 是**必须**的（VitePress 内联明暗初始化、mac 检测、
站点数据三段脚本），`connect-src 'self' https://api.github.com` 是链接预览与仓库卡唯一的
外域请求。**新增要 fetch 的 provider 必须把 API 域名加进 `connect-src`**，否则被静默拦截、
永远降级成域名卡；`img-src 'self' data:` 供 LQIP；`frame-ancestors` 在 meta 里被浏览器忽略，
点击劫持只能将来换托管或前置 CDN 时用真实响应头解决。

### 404 兜底（构建期）

VitePress 的 `404.html` 是纯 SPA 空壳（禁用 JS / 抓取预览时是一张白页）。
`support/not-found.ts` 在 `buildEnd` 里往产物 `<body>` 开头注入 `<noscript>` 兜底
（纯 HTML + 内联样式、两个语言首页入口带 base、检测 `<!-- nojs-404 -->` 保证幂等）。
`NotFoundPage.vue` 是客户端组件，“回到首页”指向**当前语言首页**，不是站点根 `/`。

### RSS（含 `content:encoded`）与 robots

`support/rss.ts` 在 `buildEnd` 为每种语言写 `/<locale>/index.xml`：`<description>` 只放
纯文本摘要；`<content:encoded>` 放**全文 HTML**，来源是 `transformHtml` 阶段收进
`support/rendered.ts` 的 `.prose` 正文——图片地址、`{width=100}`、代码高亮、标题锚点
与网页完全一致，不再出现「feed 里的图是 ./banner.png」。写进 feed 前会删掉
`srcset` / `sizes` / `loading` / `data-lightbox` 等网页专用属性、把 `<figure>` 压平成
`<img>` + `<p><small>图注</small></p>`、站内相对地址补成绝对地址（先剥已有 base 再拼
`SITE_URL`，避免 `/<repo>/<repo>/`）。代码块另由 `support/feed-code.ts` 的 `sanitizeFeedCode()` 清洗：删掉
头部条、复制按钮、语言标识与代码分组的 tab 条，`[路径]` 保留成 `<p><small>路径</small></p>`，
`<pre>` 去掉全部属性与 `--shiki-*` 自定义属性（详见「代码块管线」）。

`robots.txt` 由 `support/robots.ts` 写死 `Sitemap:` 绝对地址，与 sitemap 的 hostname 同源，
不在 `public/` 里放静态文件。

---

## 三·五、图片管线与内容增强

> 写作侧怎么用见 [WRITING.md](./WRITING.md) 第三节。这里讲**实现**。

### 一句话

**源图放哪、什么格式都不重要；构建期统一转成多档 webp，按内容 sha256 命名，
原图原样进产物，正文渲染成 `<figure>` 供点击放大。**

### 两段式设计（这是整套实现的核心约束）

markdown-it 的渲染是**同步**的，而 sharp 转码是异步的。所以拆成两段：

```text
① resolveMedia()  同步   读字节 → sha256 → 探尺寸 → 决定格式与档位 → 算好所有文件名
② encode()        异步   真正压 webp（构建期批量并行；dev 按需）
```

渲染规则只调 ①，因此它永远能在同步上下文里拿到 `<img src>` / `srcset` 需要的
全部信息；② 的产物只是字节，晚一点没关系。

### 文件名规则

| 产物                              | 说明                                   |
| --------------------------------- | -------------------------------------- |
| `assets/media/<sha12>-336.webp`   | 展示档（还有 `-672` / `-1008` / 原宽） |
| `assets/media/<sha12>-lqip.webp`  | 20px 模糊占位（构建期 base64 内联）    |
| `assets/media/orig/<sha12>.<ext>` | 原图，**原始字节**，不重新编码         |

`sha12` 是**源文件字节 sha256 的前 12 位**。同一个键带来三个能力：跨文章 / 跨语言去重、
换图即换 URL（缓存自动失效）、文件名由我们算而不是 Vite。

### 档位、`srcset` 与 LQIP

`planner.ts` 的常量：

- 展示档 **336 / 672 / 1008**（对应窄屏 @1x、桌面 @1x、窄屏 @3x）；
- `MASTER_CAP = 2016`（672 × 3）：源图更宽时补一档 2016 封顶；
- **永不放大**：大于等于源宽的档直接丢弃；小于 336 的源图只出一档（原宽）；
- `sizes` = `(min-width: 704px) 672px, calc(100vw - 32px)`——**704 = 672 + 两侧各 16px**，
  不是页头那个 720 断点；
- `<img src>` 取「最接近 672 且不小于它」的档（`pickSrcWidth`），不支持 `srcset` 的
  浏览器与 RSS 阅读器也拿到合理尺寸；
- LQIP：位图额外产出一张 20px / quality 30 的模糊 webp，转码后**立刻 base64 内联**
  `data-lqip`，不作为独立 URL 发射；矢量、窄于 20px 的图不出 LQIP；LQIP 失败静默降级
  （返回 `null`），绝不能弄挂构建。

**格式裁决**：png / jpg / jpeg / webp / avif 正常转码；gif 只出一档并转 animated webp；
svg 不栅格化（不出档位、不转码）；tiff / heic 转码但原图浏览器打不开（给 warning）；
bmp / ico / psd 直接报错并告诉作者另存为什么。原图上限 40 MB / 5000 万像素。

**图注只来自 `title`**（`![alt](x.png '标题')`），不把 alt 当图注；alt 从 token 的
children 渲染（直接读 `attrGet('alt')` 会拿到空串，把无障碍文本丢掉）。

### 为什么必须关掉 `transformAssetUrls` 的绝对路径改写

`config.ts` 里有 `vue.template.transformAssetUrls.includeAbsolute = false`。
不关的话，`<img src="/assets/media/<sha>-672.webp">` 会被 `@vitejs/plugin-vue`
改写成 ESM import：找不到就构建失败，恰好存在就被 Vite 重新哈希（我们算的指纹作废）。
关掉之后相对路径**仍然**会被 import——作者写错相对路径时依旧在构建期 hard fail，
而不是静默产出 404。图片 URL 的 base 因此由 `planner.ts` 的 `withBase` 自己拼。

### 构建期与 dev 的差异

| 阶段                     | 做什么                                                          |
| ------------------------ | --------------------------------------------------------------- |
| build / `buildStart`     | 预扫全部 `.md` 的图片引用 → 批量转码 → `assertReady()` 校验     |
| build / `generateBundle` | `emitFile` 把变体与原图写进产物（**只 client build**）          |
| dev / `configureServer`  | 中间件按需转码，URL 与构建期完全同构，`Cache-Control: no-store` |

三个必须记住的坑：① VitePress 会跑两次 Vite build（client + SSR），SSR 的 outDir 是
`.temp` 且结束即删，所以 `emitFile` 只在 `config.build.ssr === false` 时做；
② dev 中间件必须注册在 `configureServer` **函数体里**（放返回的后置钩子会排在 SPA
fallback 之后，`req.url` 已被改写成 `/index.html`；函数体里 `req.url` 仍带 base，要自己剥）；
③ 预扫要兼容 `public/` 下的引用（`/placeholder.svg` 不参与发射，但必须能解析出自己的 URL）。

### 缓存

转码结果缓存在 `.vitepress/cache/media/`（`.gitignore` 与 `.oxfmtignore` 同时忽略）。
缓存键包含：

```text
源 sha256 | 宽度 | 参数(quality/effort) | PIPELINE_VERSION | platform | libvips 版本 | webp 版本
```

**后三项不能省**：Windows 与 Linux 的 libvips 构建不同，少了平台/版本项，
本地产物会被 CI 的缓存悄悄冒充，出现「本地对、线上不对」。

改了编码参数、档位算法或命名规则，**必须把 `transcode.ts` 的 `PIPELINE_VERSION` +1**
（当前 2，因为新增了 LQIP），否则缓存会继续返回旧参数产出的字节，且没有任何提示。

### 图片在 Markdown 里怎么被提升

`support/media/render.ts` 在 core 阶段把「独占一段、只有一张图」的段落改写成
`<figure class="prose-media">`。**故意不提升**：行内图、作者自带链接的图、外链图、
`{data-plain}` 图。规则必须挂在 `curly_attributes`（VitePress 的 attrs 插件）**之后**，
否则 `{width=100}` 还没被消费，children 里多一个文本节点，图就失去点开放大；
裸 markdown-it（单测 / bio）没有 attrs 插件，`ruler.after` 找不到规则名会抛错，
所以 `installFigureRule` 里 catch 后退回 `inline` 之后。

### 改图片管线 / 查看器时的检查清单

```text
□ pnpm test                     纯函数单测（档位/命名/头部探测/figure 边界）
□ pnpm build                    看 dist/assets/media/ 是否按预期出档
□ 同一张图放中英两个目录        产物里应只有一套变体
□ 故意放一张 .bmp               构建应失败且提示「另存为 PNG」
□ pnpm dev 打开文章             图片应能显示（走 dev 中间件）
□ 点开图片                      查看器能翻页/缩放/下载原图；打开首屏是 2016 档不是 336
□ 浏览器后退                    浮层关闭，且 html.overflow 复原
```

查看器的交互全挂在 `ImageViewer.vue` 的指针手势上，改这块时尤其注意：
`setPointerCapture` 会抢走按钮的 click（起点在 `button, a[href]` 上不要接管）；
`touch-action` 必须写在 `.lightbox__stage` 而不是根上；挑档要按舞台像素
（`fitted.width × scale × dpr`），首次测量前 `fitted` 是 1px，要用视口宽兜底。

### 链接悬浮预览（provider 注册机制）

正文链接悬浮 300ms 后弹出预览卡（`LinkPreviewCard.vue` + `useLinkPreview.ts`），
键盘 focus 同样触发（150ms，离开宽限 200ms）。数据按 **provider 注册表**分发
（`theme/support/link-preview/`）：

```text
core.ts        纯函数：URL 解析（GitHub repo / bilibili BV号）、缓存键、TTL、域名兜底卡
providers.ts   provider 注册表：站内 → GitHub → bilibili（顺序即优先级）
```

**注册表里只有三个 provider**：站内文章（零网络，数据已在 `posts.data.ts` 里）、
GitHub（`api.github.com`，CORS 可用）、bilibili（**不发请求**，直接出域名卡，因为它的
web 接口带 `Origin` 即 403 且无 CORS 头）。**没有通用外链兜底**：不认识的链接悬浮不弹卡。

**依赖注入是硬约束**：`createProviders({ posts, messages })` 必须由 `PageShell`
在 **setup 期间**调用（posts / messages 内部走 `inject()`，离开 setup 会抛错），
响应式引用被闭包捕获，悬浮回调里只读 `.value`。

**运行时缓存**：内存 Map + `localStorage`（键 `emanyzwww-link-preview:<provider>:<url>`），
TTL 24 小时。缓存键会归一化 URL（小写 host、去尾斜杠、去 `utm_*` / `spm` / `ref` /
`fbclid` 等跟踪参数）；同一链接重复悬浮零请求，拿不到的结果（`data: null`）也进缓存，
TTL 内不反复重试。fetch 必须自带超时（4000ms），拿不到返回 `null`，调用方降级成
`fallbackSite` 域名卡，卡片永不空白。

**新增一种链接类型**：`core.ts` 加纯解析函数 → `providers.ts` 写一个 `LinkProvider`
（`id` / `match` / `fetch`，可选 `fallbackSite`）插进 `createProviders()` →
把 API 域名加进 CSP `connect-src`（漏了会被静默拦截）→ 需要图标就加进 `shared/icons.ts`、
`IconName` 与 `LinkPreviewCard.vue` 的 `PREVIEW_ICONS` 白名单
（当前 `github / globe / link / play`，不在白名单就不渲染图标）。

### 块级指令（`:::github` 等）

**这是本站唯一的块级扩展入口**，实现在 `support/markdown/`：`index.ts` 是装配点
（`applySiteMarkdown()`，页面正文与非页面共用）；`directives/` 下 `registry.ts`
（类型、注册表、报错与拼写纠错）、`parse.ts`、`block.ts`（配对围栏、内部 Markdown、
按 hr 分栏）、`images.ts`（连续图片拆段，画廊用）、`builtins.ts`（六个指令：
github / link / figure / quote / columns / gallery）与 `index.ts`（`installDirectives()`）。

**装配顺序有语义**：`extendMarkdown`（行内）→ `media`（仅正文，安装 `media_figure`）
→ `installDirectives`。图片拆段的 core 规则要靠 `before('media_figure')` 精确落位，
反过来装会抛 `Parser rule not found`。

**四条不可协商的纪律**（写在 `registry.ts` 顶部，改动前先读）：

1. **构建期禁止任何网络请求**。指令的 `open()` / `close()` 必须同步、纯函数。
   有测试守着：`tests/offline-build.test.ts` 把 `fetch` 换成抛错并**真的跑一次构建**。
2. **禁止「先占位、稍后改写」**。指令一旦渲染就是终态，没有后续阶段再动产物。
3. **基线必须可用**。断网 / 禁 JS / 接口失败时，读者看到的仍是一条真链接。
4. **未注册的指令必须报错**，并列出可用类型——静默降级成本文会让作者以为语法生效了。

**GitHub 仓库卡：构建期只出链接，数据在浏览器补。** 构建期产出完整的
`<a href="https://github.com/vuejs/core">` 骨架；运行期 `theme/embeds/enhance.ts`
在进入视口 200px 内才 fetch，成功后只往 `.embed` 内部**追加**描述/★/语言/相对时间，
失败什么都不做。纪律：只加不改结构（避免 hydration mismatch）、懒加载、去重 + 缓存
（同 URL 共用一个 Promise；`localStorage` 键 `emanyzwww-embed:<fullName>`，TTL 24h）。
卡内**所有文字容器必须是 `<span>`**，不能用 `<p>`（`<a>` 里放 `<p>` 会被浏览器拆卡，
由 `tests/directives.test.ts` 守着）。

**新增一个指令**：在 `builtins.ts` 写一个 `Directive`（`name` / `summary` / `example` /
`body` / `open()` / `close()`，可选 `split` / `splitImages`）加进 `DIRECTIVES`；
需要运行期数据就在 `theme/embeds/` 加增强器，并在 `open()` 里输出 `data-embed="名字"`
作为钩子；样式加到 `content.css` 的「嵌入块」一节（复用 `.embed` 骨架）；
补 `tests/directives.test.ts` 用例（正常形态 + 缺参数 + 未知参数）。

**嵌入块的 DOM 契约**：`.embed` 只管外边距；`.embed__link` 是可点整卡；
`.embed__icon` / `.embed__head` / `.embed__skeleton`（`data-loading` 门控）/
`.embed__desc` / `.embed__meta` / `.embed__arrow`。视觉规则按 DESIGN.md：
卡片用 `--bg-surface` + `--radius-lg`、无阴影、悬停只改描边。

**已知限制：指令不能直接放进 VitePress 内置容器。** 内置容器会先把第一个 `:::` 当自己的
闭合行，构建会失败并提示把指令移到容器外；绕过办法是**让外层围栏更长**（外层 `::::`、
内层 `:::`）。

### 代码块管线

代码块从「明暗恒深色 + github-dark-default 单主题」改成**本站自有双主题 + 常驻头部控件区**。
它横跨五处，改任何一处先看清其余四处：

| 段     | 文件                              | 负责                                                                                        |
| ------ | --------------------------------- | ------------------------------------------------------------------------------------------- |
| 构建期 | `support/markdown/code-blocks.ts` | `[路径]` 解析、`::: code-group` 跳过、扩展名推断语言、把头部标记写进 HTML                   |
| 配色   | `support/markdown/code-theme.ts`  | Shiki 双主题色板 `CODE_PALETTE`；**token 色的唯一来源**                                     |
| 视觉   | `theme/styles/content.css`        | 头部条 / Grid / 复制按钮 / 双主题桥接；底色与控件色来自 `tokens.css`                        |
| RSS    | `support/feed-code.ts`            | `sanitizeFeedCode()`：把网页专用结构清成 feed-safe（在 `rss.ts` 的 `articleHtml()` 里调用） |
| 打印   | `theme/styles/print.css`          | 去掉头部条底色与交互控件，保留路径行，强制浅底黑字                                          |

**写法与语言推断。** 在围栏信息里写 `ts [src/app.ts]`：`ts` 是语言，`[src/app.ts]` 是文件路径。
只写路径（` ``` [src/app.ts] `）时按**最后一段的扩展名**推断语言——`EXTENSION_LANG` 只登记
常见扩展名，查不到就保持纯文本、不猜。`[路径]` 是 VitePress 的既有约定（`::: code-group`
用它作标签名），会被 VitePress 自己的 fence 包装器从 `token.info` 里摘掉，不会泄漏给 Shiki。
因为 VitePress 也从 `token.info` 取语言，`installCodeBlocks` 必须在调用原 fence 规则**之前**
改写 `token.info`，晚一步就轮不到它。

**DOM 契约**（`code-blocks.ts` 注入，CSS 与 RSS 清洗器共用，顺序固定、**不要调换**）：

```text
<div class="code-block code-block--file language-ts vp-adaptive-theme">
  <span class="code-block__label" data-file="src/app.ts" title="src/app.ts">src/app.ts</span>
  <button title="Copy code" class="copy"></button>
  <span class="lang">ts</span>
  <pre class="shiki shiki-themes jade-light jade-dark vp-code">…</pre>
</div>
```

- `code-block` 必带；`code-block--file` 与 `data-file` / `title` 只在**写了路径**时出现——
  RSS 清洗器靠 `data-file` 决定保留不保留路径行。没写路径时 label 文本是语言名、无 `data-file`。
- **label 必须在 `button.copy` 前面。** VitePress 的复制逻辑写死了
  `button.nextElementSibling?.nextElementSibling` 是 `<pre>`；label 若插在 button 与 `.lang`
  之间，复制按钮拿到的就是语言名而不是代码（`tests/code-blocks.test.ts` 钉住这条契约）。
- `.lang` 恒在 button 之后，同样是复制契约的一部分；`::: code-group` 里它由 CSS 隐藏，
  且整块**不注入头部**。
- 头部条是 CSS Grid 的第一行（`--code-head-height` = 36px），代码本体固定第二行；
  路径 / 语言 / 复制按钮都是 grid item，结构上不可能与代码重叠。运行期零 JS。

**`::: code-group` 特例。** tab 条本身就是头部，逐块不再加第二条；`isInsideCodeGroup`
用容器 token 的深度计数判断（嵌套分组不误判），复制按钮由 CSS 绝对定位到分组右上角。

**为什么必须最后装。** `installCodeBlocks` 包裹的是 VitePress 的 `preWrapperPlugin`：
装得越晚越靠外层，拿到的才是「已包装、还没被别的规则改写」的 HTML。`applySiteMarkdown()`
已把它排在 `installDirectives` 之后。

**打印与 RSS。** 打印去掉头部条的底色、语言标识、复制按钮与 tab 条，但**保留文件路径**
作为纸面上的小标题；代码块换浅底黑字并允许换行。
RSS 侧 `feed-code.ts` 删掉复制按钮、语言标识、头部 label、tab 条与 `<div class="language-…">`
包装，有 `data-file` 的路径保留成 `<p><small>路径</small></p>`，`<pre>` 及其内部 span 的全部
属性（含 `--shiki-*` 自定义属性）清空但文本与实体原样保留；对没有代码块的 HTML 必须恒等输出。

**改配色的步骤**（顺序不能反）：

1. 改 `code-theme.ts` 的 `CODE_PALETTE`（浅 / 深各 10 个角色）与 `CODE_BACKGROUND`；
2. 同步 `tokens.css` 的 `--bg-code`（必须与 `CODE_BACKGROUND` 一致）、`--bg-code-head`、
   `--border-code`、`--fg-code-head`、`--fg-code-lang`、`--code-action-*`、`--code-copied-*`、
   `--ring-code`；
3. 按 DESIGN.md §9.1 用 WCAG 2.x 公式逐条复算：每个 token 对自己主题的 `--bg-code`，
   头部三档对 `--bg-code-head`；
4. 跑 `tests/code-theme.test.ts`（色板对比度 + 双主题结构）与 `tests/code-blocks.test.ts`；
5. `pnpm build` 后肉眼过明暗两套、打印预览与 RSS 输出。

---

## 四、改样式

> 三层令牌、五条设计纪律、z-index 阶梯、滚动条的完整规范都在
> [DESIGN.md](./DESIGN.md)（§2.2、§3–§6、§8、§11）。这里只记「改哪儿、别踩什么」。

### 三层令牌制度（一句话）

`theme/styles/tokens.css` 分原始色阶、语义变量、排版/间距三层，其他 CSS
**只引用变量、不写死数值**；改配色/字号/圆角/间距从 tokens 动手，规范准绳是 DESIGN.md。
代码块是唯一的分工例外：底色与头部控件色在 `tokens.css`（`--bg-code*` / `--fg-code-*` /
`--code-action-*` / `--ring-code`），**token 色本身在 `support/markdown/code-theme.ts`**，
CSS 只消费 Shiki 输出的 `--shiki-light` / `--shiki-dark`。
`--weight-medium` 只是指向 400 的兼容别名，不要再用。

### 五条设计纪律（一句话）

卡片默认无阴影（阴影只给遮挡内容的浮层）、层次靠表面色差、字重只用 400/600/700、
标题上方间距明显大于下方、圆角只用六档且嵌套守同心圆规则。
逐条理由见 DESIGN.md §3–§6。

### 样式分三层：共用两层，独立一层

```text
① 令牌层 tokens.css             颜色 / 字号 / 间距 / 圆角 / 阴影 / 动效 / 层级（全站共用）
② 外壳层 base / layout / components / posts / widgets / mobile / search
                                页头、页脚、卡片、导航、时间线——不碰正文排版
③ 正文层 content.css            只作用于 Markdown 渲染结果
```

正文层独立：Markdown 是外部输入（DOM 不受我们控制）、外壳要紧凑而正文要宽松
（17px / 行高 1.9）、将来换渲染器只重写 `content.css`。除嵌入块 `.embed` 外，
`content.css` 的选择器都挂在 `.prose` 下（约 130 处）。唯一刻意「同字号不同行高」：
外壳 `--leading-relaxed = 1.75`、正文 `--leading-loose = 1.9`（中文长文需要更宽行距）。

### 十四个样式文件的职责

顺序在 `styles/index.css` 里（13 条 `@import` + 入口文件本身），**后面的能覆盖前面的**。

| 文件                   | 管什么                                                                                       | 什么时候进这里改             |
| ---------------------- | -------------------------------------------------------------------------------------------- | ---------------------------- |
| `tokens.css`           | 全部设计变量（含 z 轴阶梯、浮层色、动效时长曲线、安全区）                                    | 换色、换圆角、换字号、换间距 |
| `base.css`             | 重置、body、a、图标尺寸、自绘滚动条、焦点环、跳转链接                                        | 调基础排版、改滚动条         |
| `layout.css`           | 容器、两栏/三栏网格、粘性侧栏、断点                                                          | 改整体骨架、侧栏宽度         |
| `components.css`       | 页头、页脚、导航、搜索入口、按钮、卡片、标签、徽章、空状态                                   | 改页头页脚、按钮样式         |
| `content.css`          | **正文专属**：标题、段落、列表、引用、表格、代码块（含头部控件区与双主题桥接）、图片、嵌入块 | 改文章正文观感               |
| `posts.css`            | 时间线、文章卡片、文章头尾、目录、分页、上下篇、进度条、404                                  | 改列表和文章页               |
| `widgets.css`          | 资料卡、标签卡、最近文章卡、统计卡、标签云                                                   | 改侧栏卡片                   |
| `mobile.css`           | 页头隐藏、导航抽屉、悬浮胶囊、目录浮层、手机断点布局                                         | 改移动端交互                 |
| `search.css`           | 全站搜索面板                                                                                 | 改搜索面板                   |
| `lightbox.css`         | 图片查看器（满屏浮层，与搜索同一类）                                                         | 改查看器                     |
| `link-preview.css`     | 链接悬浮预览卡（小浮层，Teleport 到 body）                                                   | 改悬浮卡                     |
| `route-transition.css` | 页面切换与主题切换的 `::view-transition-*`                                                   | 改整页过渡                   |
| `print.css`            | 打印样式                                                                                     | 调打印                       |
| `index.css`            | `@import` 汇总，别放规则                                                                     | 加新样式文件时登记           |

> **`content.css` 必须排在 `posts.css` 之前。** `posts.css` 里有 `.prose h2` 的
> 移动端缩小规则，要压过正文默认值。
>
> **`mobile.css` 在 `lightbox.css` 之前**：查看器的移动端规则要压过 mobile 的通用规则。
> **`route-transition.css` 在 `print.css` 之前**：打印不需要页面过渡。

### 响应式断点

| 断点                                                              | 行为                                                       |
| ----------------------------------------------------------------- | ---------------------------------------------------------- |
| `max-width: 1120px`                                               | 三栏 → 单栏（右栏目录移到正文下方）                        |
| `max-width: 960px`                                                | 两栏 → 单栏（侧栏移到正文下方）                            |
| `max-width: 720px`（或 `pointer: coarse` 且 `max-height: 500px`） | **切到移动端模式**：页头换单行、侧栏整体隐藏、胶囊接管导航 |
| `max-width: 640px`                                                | 上下篇变单列                                               |

移动端媒体查询**不是只有 `max-width: 720px`**：横屏手机（粗指针 + 矮视口）也走移动端
布局，所以规则写成 `(max-width: 720px), (pointer: coarse) and (max-height: 500px)`。
这个断点在 `mobile.css` / `search.css` / `posts.css` 里重复了多次，**改一处要同步其余几处**。
720px 是**模式切换**而不是「缩小一号」：跨过它之后导航换成「汉堡抽屉 + 悬浮胶囊」，
侧栏卡片离开文档流（精简资料条移进抽屉）。改断点要同时看 `--header-height`
（移动端 3.5rem、桌面 4rem）与 `mobile.css` 整块规则。加规则改对应文件末尾的
`@media` 块，别新建文件。

### 改配色后必须做的事

按 DESIGN.md §9.1 的公式复算每个前景/背景组合的对比度（全部 AA 以上），再跑
`pnpm build` 后肉眼过一遍明暗两套。代码块要额外算两遍：`code-theme.ts` 的每个 token 对着
自己主题的 `--bg-code`，头部路径 / 语言 / 复制图标对着 `--bg-code-head`（步骤见「代码块管线」）。
注意装饰边框（`--border-subtle` / `--border-strong`）不按 3:1 要求，只有控件边框
（`--border-control`）必须 ≥ 3:1——把装饰边框也压到 3:1 会让界面变成一堆灰框。令牌完整性的口径：被引用但未定义的必须修；定义了但未引用的
通常是有意保留（完整色阶、语义别名、预留档位），不必强求清零。

### 样式特异性的两个坑（都踩过）

1. **兜底规则可能压过具体规则。** `.prose > div > div > * + *` 的特异性是 (0,1,2)，
   比 `.prose h2` 的 (0,1,1) 高——于是 h2 的上间距被通用规则覆盖。修法：给兜底规则包
   `:where()` 把特异性降到 0。
2. **去掉链接下划线要显式写。** `base.css` 给所有 `a` 加了常驻下划线（色盲用户的非颜色提示），
   块级导航链接（`.m-nav__link`、`.locale-seg__btn`、`.site-nav a`、`.card` 内部链接等）
   必须自己写 `text-decoration: none`。

### 常见改动

| 想改       | 改哪个变量                                                                       |
| ---------- | -------------------------------------------------------------------------------- |
| 强调色     | `--teal-*` 色阶（明暗各映射一次）                                                |
| 画布色调   | `--gray-25`（浅）/ `--gray-900`（深）                                            |
| 圆角风格   | `--radius-xs/sm/md/lg/xl/full`（六档）                                           |
| 整体字号   | `--text-*`（正文是 `--text-md` = 17px）                                          |
| 间距节奏   | `--space-*`（4px 基准）                                                          |
| 正文字体   | `--font-sans` / `--font-mono`                                                    |
| 主体宽度   | `--layout-max`                                                                   |
| 正文行宽   | `--layout-measure`（当前 42rem ≈ 39 汉字/行）                                    |
| 侧栏宽度   | `--aside-width`                                                                  |
| 页头高度   | `--header-height`（改后注意 `scrollOffset`）                                     |
| 层级       | `--z-*` 命名阶梯，**禁止** `calc(var(--z-header)+N)`                             |
| 滚动条色   | `--scrollbar-thumb*`（三档：静止/悬停/拖拽）                                     |
| 代码块配色 | `code-theme.ts` 的 `CODE_PALETTE` + `tokens.css` 的 `--bg-code*`（两套都要复算） |

### 明暗主题的机制

VitePress 通过给 `<html>` 加 `.dark` 类切换。**用语义变量，两套自动生效**：
`background: var(--bg-surface)` 而不是 `#fff`。不要用 `[data-theme="dark"]`
（旧 Hugo 站的写法）。深色主题不是浅色的反相：表面不用纯黑、卡片比画布**亮**、
强调色换成浅色版。**新增颜色必须两套都写。**

### 动效层（要动动画时先读这一节）

动效是**一套横跨多文件的能力**，规范在 DESIGN.md §7，这里是实现索引。

| 机制         | 文件                                         | 作用                                                              |
| ------------ | -------------------------------------------- | ----------------------------------------------------------------- |
| 进出状态机   | `composables/usePresence.ts`                 | `v-if` 不能挂在业务开关上（否则退出动画没地方播），改挂 `present` |
| 导航前关浮层 | `support/overlay.ts` 的 `closeAllOverlays()` | 修过「点搜索结果后面板不关、滚不动」的 bug                        |
| 页面过渡     | `support/route-transition.ts`                | 接在 VitePress router 钩子上，所有导航方式统一                    |
| 主题过渡     | `support/theme-transition.ts`                | View Transitions 只在「切换那一刻」拍快照，无常驻过渡代价         |

**给新浮层加进出动画的步骤**：`usePresence(open)` 拿 `present` / `exiting` → 模板
`v-if="present"` + `:class="{ 'is-exiting': exiting }"`（进入动画挂基础选择器、退出挂
`.is-exiting` 后裔）→ 滚动锁与焦点归还移到 `watch(present)` → `registerOverlayCloser()`
登记（客户端 only）→ `prefers-reduced-motion` 下把进入与退出两条都列 `animation: none`。

**两条最容易踩的坑：**

- `EXIT_MS`（`usePresence.ts`，当前 160）必须等于 `--duration-exit`（`tokens.css`）。
  CSS 决定动画多长，TS 决定 DOM 留多久，`tests/presence.test.ts` 里有断言钉住。
- **不要给元素加 `view-transition-name`**。名字必须全局唯一，本站列表页会有多个
  `.page-title`，重名会让浏览器**静默放弃整次过渡**。

### 加一个样式文件

在 `styles/` 下建 `xxx.css` → 在 `styles/index.css` 里按顺序 `@import './xxx.css';`。
位置决定优先级——放 `print.css` 前面。

---

## 五、改组件

### 页面组件怎么选

`Layout.vue` 是一张查表（`page.isNotFound` 优先，其余看 `frontmatter.layout`）：

```ts
page.isNotFound              → NotFoundPage.vue
frontmatter.layout === 'home'   → HomePage.vue    首页
                    'posts'     → PostsPage.vue   文章列表 + 分页
                    'tags'      → TagsPage.vue    标签云 + 分组
                    'tag'       → TagPage.vue     单标签（动态路由）
                    其他/不写    → DocPage.vue     文章与普通页共用
```

**加一个新页面类型**：在 `components/pages/` 新建 `XxxPage.vue` → `Layout.vue` 的
`switch` 加 `case` → Markdown 里写 `layout: xxx`。不需要碰路由配置，VitePress 按文件路径
自动生成路由。

### 页面组件的标准结构

页面组件只做三件事：`useData()` 取页面数据、`useI18n()` 取语言与文案、算派生值；
布局永远用 `TwoColumn` / `ThreeColumn`（**不要自己写 grid**），正文放在
`<div class="prose"><Content /></div>` 里。约定：

- 页面大标题用 `page.title`，**不要用 `useData().title`**（后者带站点名后缀）
- 文案用 `m.xxx`，不要写死中文（否则英文站会串中文）
- 链接用 `href()` 包装（处理部署子路径）

### 三个布局外壳与 `PageShell`

| 组件          | 结构                                                                     | 用在哪                  |
| ------------- | ------------------------------------------------------------------------ | ----------------------- |
| `PageShell`   | 跳转链接 + 页头 + `<main>` + 页脚 + 胶囊 + 搜索 + 查看器 + 预览 + 滚动条 | `Layout.vue` 包在最外层 |
| `TwoColumn`   | 左侧栏 + 主内容                                                          | 首页、列表、普通页      |
| `ThreeColumn` | 左侧栏 + 主内容 + 右侧栏（具名插槽 `#aside`）                            | 文章页、标签页          |

`PageShell` 是「跨页面能力」的唯一挂载点：无障碍跳转链接与页头/页脚骨架；
**搜索状态单一持有**（桌面入口在 `SiteHeader`、移动入口在 `MobileDock`，都通过
`@search` 事件发上来，`SearchPanel` 只有一份）；图片查看器与链接预览都靠
**document 上的一次事件委托**接（入口是构建期生成的 `<a>`，不是 Vue 组件）；
自绘滚动条与页头**平级**——不能挂进 `<header>`（见文末「阅读进度条、滚动锁与自绘滚动条」）。

### 搜索：构建期索引 + 纯前端面板

不用 Algolia / VitePress 内置 local search（本站是自绘主题，开了也没有 UI 触发它，
还会引入第三方请求与外发查询词）。

**索引（`data/search.data.ts`）**：构建期遍历 `readDocs()`，排除草稿与动态路由模板
（路径含 `[` 的 `index.md`）；每条记录 `title` / `url` / `description` / `text` /
`tags` / `locale` / `kind`（post|page）。`text` 是正文转纯文本后截断 4000 字，
截断前先剥掉 VitePress 的 attrs 语法（`\{[^{}]*\}`，必须容忍 `{data-plain}` 这种
**无值属性**，旧正则只认 `=` 会漏）。标签单独成字段（标签往往不在正文里出现），
并按语言分组；数据随数据加载器内联进 chunk，不额外发请求。

**面板（`site/SearchPanel.vue`）**：桌面 `Ctrl/⌘ + K` 唤起（`SiteHeader` 另有可见入口），
手机由胶囊的「搜索」唤起。纯前端「小写包含」+ 打分：标题命中 100、标题开头 +50、
标签 30、描述 20、正文 5，取前 12 条；不引入模糊匹配库。`↑` `↓` 循环选择、`Enter` 用
`router.go()` 客户端跳转（**不要** `location.href`，否则鼠标点和键盘走会得到两种观感）、
`Esc` 关闭。面板打开即聚焦；`Teleport to="body"`、`role="dialog"`、焦点陷阱、引用计数
滚动锁；退出动画期间**保持锁**，`watch(present)` 里才释放。桌面端按触发按钮位置算
`transform-origin`，移动端恒为顶部中央。

### 移动端：断点与 Dock 状态机

手机不是「桌面的缩小版」，是另一套操作模型。**只有两种状态**：

| 状态      | 页头 | 悬浮胶囊       | 触发条件                        |
| --------- | ---- | -------------- | ------------------------------- |
| `rest`    | 显示 | 展开成横向胶囊 | 顶部 160px 内 / 向上累计 60px   |
| `reading` | 隐藏 | 收成右下角圆   | 向下累计滚过 60px（且不在页底） |

`composables/useDockState.ts` 是**模块级单例**（`SiteHeader` 与 `MobileDock` 各调一次，
共享同一状态）。判定逻辑有四个不能随手改的常量：

1. **对称滞回** `THRESHOLD = 60`：进入/退出各需**持续同向累计 60px**，方向一反转累加器
   立即归零；不是「反向 6px 就恢复」（旧写法会让状态在滚动手势里来回抽搐）。
2. **冷却期** `COOLDOWN = 420ms`：一次切换后静默，吃掉惯性衰减与抖动。
3. **程序化滚动抑制**：`resetDock()` 后进入「等滚动停稳」模式——连续 140ms 无位移
   （`SETTLE_IDLE_MS`）才退出，另有 2000ms 硬上限兜底；`touchstart` / `wheel` /
   `keydown` 会立即结束抑制（读者接手）。不用固定 700ms 的原因：平滑滚动实测跨章节
   约 750ms，还要叠加 iOS 解锁延迟，「点目录后 chrome 有概率收起」就是这么来的。
4. **顶部保护带** `TOP_GUARD = 160`：刚进页面、跳转后回顶时永不进入 `reading`。
   只在**滚动**上判定，不再挂 `touchstart` / `touchmove`——触摸不携带意图，位移才携带。

`MobileDock` 的胶囊右边缘由 `transform` 百分比钉死：
`translateX(calc(50vw - var(--dock-inset) - 100%))`，收缩时**只改 `width`**，
不要插值 transform 或改 right（那会让右边缘跟着漂）。只有「本页有 H2/H3 目录」的
文章页才允许收成圆（`canCollapse`），首页/列表页保持展开。

浮层与滚动锁由 `support/overlay.ts` 统一管理：引用计数、锁 `<html>`（不是 body）、
iOS 额外固定 body、解锁先用 `behavior: 'instant'` 归位再通知 `onScrollLockRelease`；
导航前 `route-transition.ts` 调 `closeAllOverlays()` 强制关闭（细节见文末「滚动锁」）。

手机布局的几处硬约束：

1. `env(safe-area-inset-*)` 需要 `viewport-fit=cover`：`config.ts` 的 `head` 显式覆盖了
   viewport meta，`public/index.html` 里的那条必须同步，否则安全区恒为 0 且无报错；
2. 停靠抬升只用 `--dock-lift` 一个变量，内部是 `max()` 不是相加；
3. 浮层必须 `Teleport to="body"`：祖先 `.site-header` 的 `backdrop-filter` 会为
   `position: fixed` 后代创建包含块，浮层会被裁成页头那么高；
4. 抽屉里不能用下拉菜单（会被 `overflow-y: auto` 裁掉），语言用
   `LocaleSwitch variant="segmented"` 分段按钮；
5. 胶囊外层是 `height: 100dvh` 的固定层，浏览器工具栏收放由合成器跟随，
   **不要**再写 JS 逐帧算视口（`PageShell` 里没有视口补偿代码）。

**手机上隐藏了哪些桌面内容，去哪找**：

| 桌面位置       | 手机上                                   |
| -------------- | ---------------------------------------- |
| 页头横向导航   | 汉堡 → 抽屉                              |
| 左栏资料卡     | 抽屉底部精简资料条（头像 + 名字 + 图标） |
| 左栏标签卡     | 抽屉的「标签」导航项                     |
| 右栏目录卡     | 胶囊的「本页目录」（唯一入口）           |
| 搜索（快捷键） | 胶囊的「搜索」（桌面另有可见入口）       |

### 侧栏卡片

`AsideWidgets.vue` 是容器，按 `SITE.widgets` 的顺序渲染，`REGISTRY` 里**只有两张卡**：

```ts
const REGISTRY = { profile: ProfileCard, tags: TagsCard } as const
```

`OutlineCard` / `StatsCard` / `RecentPostsCard` 不经过注册表：文章页由 `DocPage`
的 `#aside` 直接挂（有目录用 `OutlineCard`，否则 `StatsCard`），`TagsPage` 右栏用
`StatsCard` + `RecentPostsCard`。

**加一张侧栏卡**：新建 `components/aside/MyCard.vue`（用 `.card` / `.card__title` /
`.widget__body` 骨架）→ 在 `AsideWidgets.vue` 的 `REGISTRY` 加一行，并给 `types.ts` 的
`WidgetName` 加 `'mycard'` → 在 `data/site.ts` 的 `widgets` 数组里加名字（否则只是登记，
不显示）。名字拼错会在 `pnpm typecheck` 报错——这是用联合类型而不是字符串的原因。

### 加图标

图标真实表在 **`.vitepress/shared/icons.ts`**（`theme/support/icons.ts` 兼容层已删除），
导出 `ICONS: Record<IconName, IconDef>`、`getIcon()`（非法名回退 `link`）与
`renderIcon()`（构建期拼内联 SVG）。

两步：在 `ICONS` 加条目 → 在 `types.ts` 的 `IconName` 加字面量。之后运行期用
`<AppIcon name="star" />`（组件直接 import `shared/icons`），构建期（块级指令）用
`renderIcon()` 拼字符串。尺寸与颜色统一由 CSS（`.icon` + `currentColor`）控制，
构建期产物的 `aria-hidden` / `focusable` 与 `AppIcon` 一致。

### 加文案（界面文字）

`types.ts` 的 `Messages` 加字段 → `theme/i18n/zh-cn.ts` 与 `en.ts` 各补一条（缺了会 TS
报错）→ 组件里 `m.xxx`；带变量的文案用 `format(m.termCount, { count: 3 })`。
`Messages` 接口强制中英对齐，漏翻译会在 `pnpm typecheck` 时报错。

### 加组合式函数

`theme/composables/` 下按功能拆，文件名与函数名一致、`use` 开头；只做数据派生，
不碰 DOM（碰 DOM 的放 `support/`）。从 `usePosts()` 取当前语言文章（已按 locale 过滤、
已排序、已剔草稿），用 `computed` 派生即可；不要自己再读 `posts.data`。

**现有组合式函数（12 个）**：`usePosts`（当前语言文章）、`useTaxonomy`（标签汇总）、
`useCurrentPost`（当前页是否文章）、`useAdjacentPosts`（上下篇）、`useLocaleSwitch`
（语言切换目标）、`useActiveAnchor`（目录高亮）、`useReadingProgress`（进度 0–1）、
`useDockState`（移动端阅读态）、`useScrollBar`（自绘滚动条几何与拖拽）、`usePresence`
（浮层进出）、`useImageViewer`（查看器单例）、`useLinkPreview`（预览单例）。

**`useLocaleSwitch` 的目标地址按五级推导**（实现见 `composables/useLocaleSwitch.ts`）：

1. 当前页是文章且有配对键 → 直达另一语言的同一篇（派自 `translationKey` 或目录编号）；
2. 目标语言存在完全同名的页面（`pages/` 下）；
3. 当前页是文章但目标语言没翻译 → 目标语言的**文章列表页**；
4. 其它页面 → 同栏目索引（如标签详情退回标签总览）；
5. 再不行 → 语言首页。

数据源是 `posts.data.ts`（构建期算好配对键）与 `pages.data.ts`，不在运行时猜路径。
`config.ts` 的 hreflang 互指复用同一个配对索引，保证 SEO 互指与切换行为一致。

**模块级单例**：`useDockState`、`useImageViewer`、`useLinkPreview` 都是单例，可以多处
调用、不会重复绑定；不要改成「每个组件各持一份 ref」，否则两个组件会算出不同结论。
`useScrollBar` 不是单例（只有 `ScrollBar` 一个消费者），但它复用 `support/scroll.ts`
这个全站唯一的滚动订阅；新加「滚动联动」效果要接进去，不要自己 `addEventListener('scroll')`。
`useImageViewer` 刻意**零 props / 零 emits**：画廊是**当前文章内**全部可放大图片
（按 DOM 顺序、按 `data-media-key` 去重），每次打开重新扫描；查看器按舞台像素挑档。

### 加数据字段（进阶）

以「给文章加 `cover` 封面图字段」为例：`types.ts` 的 `PostSummary` 加字段 →
`support/content.ts` 的 `toPostSummary` 里从 `doc.data` 取值 → 组件里用 `post.cover`。
**不要**在组件里直接读 `frontmatter` 拿文章信息——那样每个组件都要自己解析，
且拿不到列表页的数据。所有文章级信息都应该走 `PostSummary`。

---

## 六、标签与路由

### 标签页是怎么来的

`docs/zh-cn/pages/tags/[tag]/index.md` 是模板，`index.paths.ts`（构建期跑）生成具体路由：

```ts
import { readPosts } from '../../../../../.vitepress/support/content'

export default {
  watch: ['../../../../**/*.md'], // 文章变了就重新生成

  paths() {
    const slugs = new Set<string>()
    for (const post of readPosts('zh-cn')) {
      for (const tag of post.tags) slugs.add(tag.slug)
    }
    return [...slugs].toSorted().map((tag) => ({ params: { tag } }))
  },
}
```

所以：**文章加了新标签 → 自动出现标签页**，不需要写文件。
同理，`docs/zh-cn/pages/posts/page/[page]/index.paths.ts` 生成分页路由（第 2 页起，
第 1 页就是 `/pages/posts/`，不生成 `/page/1/`）。

> 注意：VitePress 1.6.4 **没有** `defineRoutes` 辅助函数（2.x 才有），
> 所以这里是裸 `export default`，别写成 `defineRoutes({...})`。

### 标签 URL 转英文

默认标签名即 URL（`/zh-cn/pages/tags/随笔/`）。想变英文，改 `data/taxonomy.ts`：

```ts
export const TAG_SLUGS: Record<string, string> = {
  随笔: 'essay', // /zh-cn/pages/tags/随笔/ → /zh-cn/pages/tags/essay/
  工具: 'tools',
}
export const TAG_LABELS: Record<string, string> = {
  随笔: '随笔', // 展示名（可用来统一大小写）
}
```

**改 slug = 换地址 = 旧链接 404**。要保留旧链接，在 `public/` 放跳转页。

### 分页

第 1 页是 `/<locale>/pages/posts/`，第 2 页起是 `/<locale>/pages/posts/page/N/`。

- 每页几篇：`site.ts` 的 `postsPerPage`；分页计算：`theme/support/pagination.ts`（纯函数）
- 页码越界会自动夹到 `[1, totalPages]`，不会白屏；但越界**路由本身**不存在（404），
  夹取只用于「页面已存在、参数异常」的情况

### 命令行脚本体系

写文章时用得最多的是 `pnpm new` 与 `pnpm posts`，它们**不是**各自独立的脚本，
而是共享同一套内核。

**为什么单入口 + 共享内核**：`package.json` 里所有自有命令都指向
`tsx scripts/run.ts <命令>`：

```text
pnpm new    →  tsx scripts/run.ts new
pnpm posts  →  tsx scripts/run.ts posts
pnpm check  →  tsx scripts/run.ts check
pnpm guide  →  tsx scripts/run.ts --help
```

`run.ts` 按命令名动态 `import` 对应模块，并统一负责参数透传与错误出口
（业务代码只管 `throw new Error('人话')`，由它打印成一行 `✗ 原因` 并置非零退出码；
`DEBUG=1` 时才打印堆栈）。

**为什么命令脚本要复用 `.vitepress` 里的定义**：

| 事实                  | 唯一来源                                       | 谁在用                      |
| --------------------- | ---------------------------------------------- | --------------------------- |
| 有哪些语言            | `.vitepress/data/site.ts`                      | 构建期、主题、**命令行**    |
| 站点时区              | `.vitepress/data/site.ts`                      | RSS、日期格式化、**命令行** |
| 文章 frontmatter 字段 | `scripts/lib/frontmatter-schema.ts`            | `new` / `check` / `fix`     |
| 文件夹路径与通用换算  | `.vitepress/support/*` + `scripts/lib/site.ts` | 构建期路由、**命令行**      |

因此 `scripts/lib/` **不复制**这些定义，只做再导出。加一门语言或加一个
frontmatter 字段时，改一处，构建与命令一起跟上。

**`pnpm list` 为什么不存在**：`list` 是 pnpm 的内置命令，会在执行脚本之前先解析参数
并直接失败，脚本根本不会启动。所以对外统一用 `pnpm posts`；`list` 别名已删除。
同理 `pnpm help` 也是内置命令，查看总帮助用 **`pnpm guide`**。

**`pnpm clean --help` 会被 pnpm 截获**：`--help` / `-h` 是 pnpm 的**全局**标志，
在决定「跑哪个命令」之前就被消费掉了，`pnpm clean --help` 显示的是 pnpm 内置 clean
的帮助。要看本项目的帮助，直接调脚本：`npx tsx scripts/run.ts clean --help`。
其余命令没有这个问题。

**`pnpm new` 的日期与序号**：

```text
docs/<lang>/<YYYYMM>/<DDNN>/index.md
                 ↑ 年+月    ↑ 两位日 + 当日序号（北京时间的今天）
```

- 日期取**站点时区**（`Asia/Shanghai`），不是运行机器的本地时区；
- 序号扫**目录名**得出（不是扫 frontmatter），`01`、`02`…自动递增，中间有空号时优先补空号；
  满 `99` 直接报错而不是变成三位；
- frontmatter 的**全部字段**一次写全，字段表来自 `scripts/lib/frontmatter-schema.ts`；
  `slug` 由标题按 `support/slug.ts` 推导后**显式写入**；`date` 写成带显式偏移的完整
  ISO 串（`2026-10-24T22:49:28+08:00`），不用裸日期；
- 支持 `--date YYYYMMDD`、`-n/--sequence NN`、`-s/--slug`、`--draft`、`--no-outline`、
  `--dry-run`。

**`pnpm check` / `pnpm fix` 的边界**：`check` 只报告、不改文件，分 `error`
（退出码 1）与 `warn`（退出码 0；`--strict` 时也失败）两级。检查项包括：必填字段、
`title` 类型/空值、`date` 可解析且带时区（必须读**文件里的原始字面量**，`gray-matter`
解析后信息就丢了）、`tags` 类型、字段顺序、未知/废弃/未补齐字段、slug 可用性、
目录日期与 frontmatter 日期一致、正文为空、正文 H1（查前先剔代码块，否则注释里的 `#`
会误报）、独占一段的裸 GitHub 链接、有 `date` 却不在文章目录。

`fix` 只做**安全**的修改：重排字段顺序、补齐可选字段（含按 title 推导 slug）、把裸日期
补成带时区格式、规范化标签。它**不会**重命名/移动目录，也不改标题、正文、已有 slug，
更不删废弃字段。

> `.gitattributes` 统一了行尾（`* text=auto eol=lf`），所以 `fix` 写回直接用 LF 是安全的，
> 不需要再「跟随正文换行风格」。**不要再删这个文件**：删了之后 Windows 上
> `core.autocrlf=true` 会让 `format:check` 在本地红、CI 绿。

**`pnpm posts` 的日期过滤**：`pnpm posts 20261024` 按目录日期匹配（`202610` + `24`），
不是按 slug；`-l` / `-t/--tags` / `--draft` / `--compact` / `--json` 可用。
`pnpm stats` / `pnpm tags` 的统计口径与站点一致（默认剔除草稿）。

### 加一个动态路由

比如「按年份归档」`/zh-cn/pages/archive/2026/`。非文章页面统一放 `pages/` 下：

1. 建模板 `docs/zh-cn/pages/archive/[year]/index.md`（写 `layout: archive`）；
2. 建生成器 `docs/zh-cn/pages/archive/[year]/index.paths.ts`：

```ts
import { readPosts } from '../../../../../.vitepress/support/content'

export default {
  watch: ['../../../../**/*.md'],
  paths() {
    const years = new Set(readPosts('zh-cn').map((post) => post.year))
    return [...years].map((year) => ({ params: { year } }))
  },
}
```

3. 加页面组件 `components/pages/ArchivePage.vue`，在 `Layout.vue` 登记 `layout: archive`；
4. 读参数：`const { params } = useData()` → `params.value?.year`。

**数一下目录深度再用相对路径**：`index.paths.ts` 在 `docs/<locale>/` 内容目录里，
引用 `.vitepress` 的相对层级随深度变化：

```text
docs/zh-cn/pages/tags/[tag]/index.paths.ts        → ../../../../../.vitepress/…
docs/zh-cn/pages/posts/page/[page]/index.paths.ts → ../../../../../../.vitepress/…
```

照抄旧文档的层级一定会错。`watch` 同理，写的是相对当前文件所在目录的 glob。

---

## 七、加功能：任务清单

### 常见任务的无脑清单

- **给文章加字段**：`types.ts` → `PostSummary` 加字段 → `support/content.ts` 的
  `toPostSummary` 里从 `doc.data` 取值 → 组件里用 `post.xxx`
- **加页面类型**：`components/pages/XxxPage.vue` → `Layout.vue` 的 `switch` 加 `case`
  → Markdown 里写 `layout: xxx`
- **加界面文字**：`types.ts` → `Messages` 加字段 → `zh-cn.ts` + `en.ts` 各补一条
  → 组件里 `m.xxx`
- **加图标**：`shared/icons.ts` → `ICONS` 加条目 → `types.ts` → `IconName` 加字面量
  → `<AppIcon name="xxx" />` 或构建期 `renderIcon('xxx')`
- **加侧栏卡**：`components/aside/XxxCard.vue` → `AsideWidgets.vue` 的 `REGISTRY` 登记
  → `types.ts` → `WidgetName` 加字面量 → `site.ts` → `widgets` 数组加名字
- **改主题色**：`styles/tokens.css` 改原始层色阶或语义层 `--accent`，再按 DESIGN.md
  §9.1 复算明暗两套对比度
- **加 CSS**：判断职责 → 对应 `styles/*.css` 末尾；只用 `var(--xxx)`；正文规则必须挂在
  `.prose` 下

### 「加一个 npm 脚本」

**先判断属于哪一类**：

| 类型                  | 做法                                            | 例子                                |
| --------------------- | ----------------------------------------------- | ----------------------------------- |
| 第三方 CLI 的直接转发 | 直接写在 `package.json`，不要包一层             | `dev`、`build`、`typecheck`、`lint` |
| 有自己的逻辑          | 在 `scripts/` 下加一个命令文件，走统一入口      | `new`、`posts`、`check`             |
| 只是给已有命令起别名  | 在 `package.json` 里指向同一个 `scripts/run.ts` | 现在没有别名需要（`list` 已删）     |

第三方 CLI 不该包脚本：多一层转发不会带来任何共享逻辑，只多一个要维护的文件。
有逻辑的命令按四步：

```text
① scripts/xxx.ts 里 export default function main(argv: string[]): void
② scripts/run.ts 的 COMMANDS 里加一行：xxx: 'xxx.ts'
③ package.json 里加：  "xxx": "tsx scripts/run.ts xxx"
④ 加进 scripts/run.ts 的 printHelp()，否则 pnpm guide 里看不到它
```

命令之间**不要各自重写**：语言校验走 `scripts/lib/site.ts`、日期换算走 `dates.ts`、
frontmatter 字段表走 `frontmatter-schema.ts`、读写走 `frontmatter.ts`、文章路径/slug
走 `.vitepress/support/article-path.ts` / `slug.ts`、参数解析走 `args.ts`、
颜色/对齐/表格走 `ui.ts`。

---

## 八、删功能：反向操作

按上面的清单反着做，**每步都要跑 `pnpm typecheck`**，TS 会告诉你漏了什么。

### 删页面 / 侧栏卡 / 图标 / 文案

```text
页面：删 docs/xxx/index.md + components/pages/XxxPage.vue + Layout.vue 的 case/import
      + site.ts 的 NAV 项（两种语言都要删）
侧栏卡：site.ts 的 widgets 去名字（立刻隐藏，组件还在）；彻底删再删 REGISTRY 条目、
      types.ts 的 WidgetName 与组件文件
图标：types.ts 的 IconName 去字面量（TS 会指出使用者）→ shared/icons.ts 删条目
      → 修调用点（含 LinkPreviewCard 的 PREVIEW_ICONS）
文案：types.ts 的 Messages 去字段 → zh-cn.ts + en.ts 删条目 → 修 m.xxx
```

### 删整块功能（以 RSS 为例）

```text
① config.ts → 删 buildEnd 里的 writeFeeds 与 transformHtml 收集
② 删 support/rss.ts 与 support/rendered.ts
③ 删 ProfileCard / SiteFooter 里的 RSS 入口
④ 删 config.ts transformHead 里的 alternate 标签
```

### 删一种语言

```text
① 删 docs/en/ 整个目录
② config.ts → locales 删 en
③ data/site.ts → LOCALES 删 en、NAV 删 en
④ types.ts → LocaleCode 改成只有 'zh-cn'（TS 会指出所有要改的地方）
⑤ theme/i18n/ → 删 en.ts，MESSAGES 删对应项
⑥ public/index.html → SUPPORTED 数组删掉 'en'
```

`LocaleCode` 这个联合类型是这套设计的关键——**改它，编译器会带你走完全部改动点**。

---

## 九、检查、测试与格式化

### 命令

```powershell
pnpm typecheck     # TS + Vue 类型检查（0 错误才算过）
pnpm lint          # oxlint：未使用变量、可疑写法、性能提示
pnpm test          # vitest：纯函数单测（26 个文件 / 514 个用例）
pnpm test:watch    # 单测 watch 模式
pnpm format        # 格式化：docs + .vitepress + scripts + 根目录几份 md
pnpm format:check  # 只检查不写入
pnpm build         # 构建（也会暴露类型问题）
```

改完代码的标准流程：`format` → `lint` → `typecheck` → `test` → `build`。`format`
显式带上了 `.vitepress` 与 `scripts`——它们不在 `docs/` 里，只写 `docs` 会漏掉主题代码
与命令行脚本。

> `tests/offline-build.test.ts` 会**真跑一次 `pnpm build`**（约 2 秒），把 `fetch`
> 换成抛错并收集任何外部请求；只想跑纯函数时用
> `PNPM_SKIP_OFFLINE_BUILD=1 pnpm test`。

### 单测覆盖什么

`tests/` 下共 **26 个文件、514 个用例**（其中 offline-build 的 1 个在默认门禁里会跑，
用上面的环境变量可跳过）。绝大多数测**纯函数**（不依赖 VitePress 运行时、不读磁盘）：

| 文件                        | 用例 | 覆盖                                                                                                    |
| --------------------------- | ---: | ------------------------------------------------------------------------------------------------------- |
| `urls.test.ts`              |   10 | 相对路径 → URL、中文编码、与 `decodePath` 互逆                                                          |
| `paths.test.ts`             |   27 | 语言前缀换算、`asLocale`、`postListPath`、`LOCALES` 一致性                                              |
| `article-path.test.ts`      |   11 | 文章路径解析（`<YYYYMM>/<DDNN>`）、配对键、route 与 URL 拼接                                            |
| `slug.test.ts`              |   14 | slug 推导（中文保留原字 / 纯拉丁 kebab-case）、可用性判断、`slugOf` 回退                                |
| `translation.test.ts`       |   10 | 跨语言配对键推导、配对索引与回退                                                                        |
| `pagination.test.ts`        |   12 | 分页边界（空列表、越界、非法 perPage）                                                                  |
| `format.test.ts`            |   18 | 日期格式化、RFC 822、字数统计、纯文本化                                                                 |
| `dev-redirect.test.ts`      |    6 | `Accept-Language` 解析                                                                                  |
| `markdown-plugins.test.ts`  |   25 | `==高亮==` 与任务列表的渲染、嵌套、**不误伤比较运算**                                                   |
| `markdown-pipeline.test.ts` |    9 | 两条渲染路径（页面正文 / 简介卡片）对同一段 Markdown 产出一致                                           |
| `code-theme.test.ts`        |   31 | 代码块色板：浅 / 深每个 token 对自己底色 ≥ 4.5:1、双主题结构、无斜体                                    |
| `code-blocks.test.ts`       |   19 | `[路径]` 解析、扩展名推断语言、头部注入契约（label 在 button 前）、空语言兜底 `text`、code-group 不注入 |
| `feed-code.test.ts`         |   14 | RSS 代码块清洗：普通块 / 路径行 / 实体保留 / 分组只留 active / 幂等 / 无块恒等                          |
| `directives.test.ts`        |   46 | 块级指令：参数解析、六个指令、分栏、图片拆段、嵌套、代码块内的 `:::`、错误文案                          |
| `offline-build.test.ts`     |    1 | **构建期零网络**：把 `fetch` 换掉再真跑一次完整构建（守核心契约）                                       |
| `shared-github.test.ts`     |   20 | URL 解析与仓库名归一化、数字缩写、相对天数                                                              |
| `link-preview.test.ts`      |   29 | 链接预览纯函数：GitHub/bilibili URL 解析、缓存键归一化、TTL、域名卡                                     |
| `media-planner.test.ts`     |   34 | 格式裁决、档位计算、命名规则、`sizes` 常量、base 拼接、LQIP 文件名                                      |
| `media-probe.test.ts`       |   18 | 图片头部尺寸探测（PNG/JPEG/WebP/GIF/SVG/AVIF 的真实文件头）                                             |
| `media-render.test.ts`      |   23 | `<figure>` 提升边界、alt/图注/宽高、`data-plain`、`data-lqip`、与 attrs 的顺序契约                      |
| `anchor-scroll.test.ts`     |   15 | 锚点留白（读 `scroll-padding-top`）、滚动扣减、**滚动锁排队**（iOS 真机 bug）                           |
| `presence.test.ts`          |   10 | 浮层进出时机、退出途中重开、`EXIT_MS` 与 CSS 契约                                                       |
| `overlay-registry.test.ts`  |    5 | 浮层强制关闭登记表：注册、注销、幂等                                                                    |
| `scrollbar.test.ts`         |   23 | 拇指长度/位置、`scrollTopForOffset` 互逆、自动隐藏边界（`shouldReveal`）                                |
| `dock-state.test.ts`        |    6 | 阅读态状态机：抑制窗口、停稳、硬上限、无位移退出                                                        |
| `scripts.test.ts`           |   78 | 命令行内核：北京时间、序号分配、frontmatter 序列化、slug、参数、建文章                                  |

几个值得单独理解的：`scripts.test.ts` 覆盖「建错会静默写坏内容」的那批函数
（`nextSequence` 会不会撞号、`stringifyFrontmatter` 会不会写坏 YAML、`isoDateInZone`
会不会差一天、`parseArgs` 的 `-l=zh-cn` 写法）；`media-probe.test.ts` 覆盖整条管线里
**唯一手工解析二进制**的地方（读错会出现「渲染尺寸与实际像素不符」，构建期完全不报错），
每个格式都用**真实最小文件头**验证；`media-render.test.ts` 用 `tests/fixtures/tiny.png`
（400×225）覆盖 `<figure>` 提升边界；`presence.test.ts` / `overlay-registry.test.ts`
守动效层两条契约（DOM 摘除时机由 `EXIT_MS` 决定、导航前必须关干净所有浮层）；
`anchor-scroll.test.ts` 守「手机上目录跳转失效」（锁持有期间必须排队，⚠️ 必须伪装
iPhone UA 才能复现，手动验证见 DESIGN.md §7.5）；`dock-state.test.ts` 守「点跳转后
chrome 有概率收起」；`scrollbar.test.ts` 守几何（拇指不越界、正反算互逆、
`shouldReveal` 的强制条件优先于超时）；`code-theme.test.ts` 守代码块配色的 AA 门槛
（每个 token 对自己主题的 `--bg-code`）；`code-blocks.test.ts` 守复制按钮的隐式 DOM 契约
（label 必须在 button 前，否则复制到的是语言名）；`feed-code.test.ts` 守 RSS 的
feed-safe 输出（无 CSS 的环境里不能残留任何网页专用结构）。

为了让这些函数能在 Node 里跑，纯逻辑刻意放在 `support/urls.ts`、`locale-paths.ts`、
`translation.ts`、`article-path.ts`、`slug.ts` 与 `theme/support/{pagination,scrollbar}.ts`，
**不 import `vitepress`**；需要 `withBase` 的包装留在 `theme/support/paths.ts`。
图片管线同理：`media/planner.ts` 与 `media/probe.ts` 是纯函数、可直接加载；
`media/registry.ts` 会读磁盘，`media/transcode.ts` 才 import sharp——所以单测不需要
原生模块。脚本侧纯逻辑放 `scripts/lib/`，不 import `vitepress`。

### lint 规则

`.oxlintrc.json` 开启 `correctness`（error）、`suspicious` / `perf`（warn），
`no-unused-vars` 为 error。新增代码若引入 `Array#sort()` 这类原地修改，会被
`unicorn/no-array-sort` 提示改用 `toSorted()`。

### 格式化覆盖什么

`.oxfmtignore` 排除了 `node_modules` / 包管理器缓存、`.vitepress/dist` /
`.vitepress/cache` / `.vitepress/.temp`、`public` / `media`、`pnpm-lock.yaml`；
其余全格式化（`.md` / `.ts` / `.vue` / `.css` / `.json`）。`.oxfmtrc.json` 关键项：
无分号、单引号、`printWidth: 100`、`tabWidth: 2`、`sortImports: true`、`endOfLine: lf`；
Markdown 用 120 字符宽、`proseWrap: preserve`；`**/*.vue` 覆盖
`singleAttributePerLine: false`（否则模板膨胀两三倍）。

### 两条 Vue 相关规则（踩过坑）

**① 组件注释不能写在 import 之上**：`oxfmt` 会把所有 `import` 提到最前面，
写在 import 之上的注释会被留在原地、夹在两条 import 中间。正确位置是
**import 块之后、第一条语句之前**。

**② 属性只在超长时换行**：`.oxfmtrc.json` 给 `**/*.vue` 覆盖了
`singleAttributePerLine: false`；默认的全局设置会让每个属性独占一行。

---

## 十、部署

### 自动流程

推送到 `master` → GitHub Actions → 质量门禁 → 构建 → 发布到 GitHub Pages。
`.github/workflows/deploy.yml` 的作业顺序如下。

1. **Quality gate**：`pnpm lint` → `pnpm typecheck` → `pnpm test` → `pnpm audit --prod`
   全部通过才构建。`audit` 刻意加 `--prod`：生产依赖树是空的，裸 `pnpm audit` 会报
   dev-only 漏洞（不进产物），让 CI 永久红灯等于关掉门禁。
2. **Resolve deployment URLs**：`xxx.github.io` → 用户站点、`BASE=/`；否则项目站点、
   `BASE=/<repo>/`。仓库变量 `SITE_URL` 可覆盖（绑自定义域名时用），产出
   `VP_BASE` / `VP_SITE_URL` 传给构建。
3. **Build**：`pnpm build`，上传 `.vitepress/dist`。
4. **Deploy**：`actions/deploy-pages`。
5. **Smoke test**：部署成功后用 `page_url` 逐条请求——稳定入口（站点根、两个语言首页、
   `pages/posts/`、`pages/about/`、`pages/tags/`、`sitemap.xml`、`robots.txt`、
   `<locale>/index.xml`）、**以 sitemap 为准**的每个页面（不再硬编码栏目地址，
   内容结构一变就会红叉）、以及 `hashmap.json` 里必须有 `zh-cn_index`
   （确认拿到真实页面而不是空壳）。任何一条非 200 就失败，补上「部署成功但线上是坏的」
   这个盲区。

所有 `uses:` 都钉到 40 位 commit SHA（可变 tag 可能被上游改指，而 `uses:` 是以
GITHUB_TOKEN 权限执行上游代码）；升级通过 Dependabot 发 PR。权限最小化：
`contents: read`、`pages: write`、`id-token: write`，并发组 `pages` 串行。

### 需要人工确认的

- 仓库 Settings → Pages → Source 必须是 **GitHub Actions**；
- 绑定自定义域名时：`public/CNAME` 写域名、`data/site.ts` 的 `SITE_URL` 改成同一域名、
  仓库变量 `SITE_URL` 也改成同一域名（`CNAME` 只在自定义域名时需要）。
  `SITE_URL` 影响 sitemap `<loc>`、RSS 绝对链接、canonical、OG `og:url`、
  `robots.txt` 的 `Sitemap:`；这些都在构建期生成，无需手改产物文件。

### 根路径 `/` 的语言跳转

`public/index.html` 会被原样拷到产物根，作为 `/` 的入口：跳转脚本放在 `<head>` 里，
在 `<body>` 解析之前就执行 `location.replace()`（不要改回「body 末尾 + 提示文字」，
会出现中转页闪现）；不写死任何域名或 base，目标是相对路径，靠
`new URL(相对, location)` 解析，因此 `/`、`/repo/`、自定义域名三种部署都能正确跳；
页面带 `noindex`，不进 sitemap、不参与 hreflang 配对；`<body>` 里只有 `<noscript>`
兜底链接。dev 阶段由 `support/dev-redirect.ts` 用 `Accept-Language` 做同样的事（302）。

**`dist/` 与 `cache/` 是构建产物，不提交**（`.gitignore` 已忽略）。

---

## 附：设计决策速查

| 决策                                                | 理由                                                                                                                                                                                                                                                                       |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 完全自定义主题，不 extends 默认主题                 | 默认主题 DOM 与样式高度耦合，还原三栏 + 卡片侧栏要大量覆盖，反而更难维护                                                                                                                                                                                                   |
| 目录式 URL（`cleanUrls: false`）                    | 不依赖服务器把 `/x` 映射到 `/x.html`，任何静态托管都能跑                                                                                                                                                                                                                   |
| 文章目录用 `<YYYYMM>/<DDNN>/`，标题只存 frontmatter | 目录名是机器身份（排序 / 跨语言配对 / 和 `date` 对账），URL 的标题段交给 `slug`；改标题不再牵动文件路径                                                                                                                                                                    |
| `shared/` 独立一层                                  | 构建期与运行期都要用的纯函数（GitHub 解析、图标表）既不能放 `support/` 也不能放 `theme/`，否则会反向依赖                                                                                                                                                                   |
| Shiki 双主题 `jade-light` / `jade-dark`             | 代码块是正文的一部分，要跟着页面明暗走；现成主题的色板与本站 jade + 暖灰无关，也没有一组能同时满足两种底色。本站自有双主题让每个 token 对着自己底色 ≥ 4.5:1（唯一来源 `code-theme.ts`）；双色的 CSS 变量切换成本，换来浅色页面不再被黑矩形截断、RSS 里不再有写死的浅色文字 |
| 日期固定 `Asia/Shanghai`                            | 避免构建机时区不同导致跨日（`new` 与 `fix` 都按站点时区）                                                                                                                                                                                                                  |
| `LocaleCode` 用联合类型                             | 改语言集合时，TS 会指出所有需要适配的位置                                                                                                                                                                                                                                  |
| 标签页用动态路由 + `paths()`                        | 新增标签无需手写文件，是静态博客最容易腐化的地方                                                                                                                                                                                                                           |
| 侧栏用注册表 + 联合类型                             | 只有 profile/tags 两张；名字拼错在 typecheck 报错，而不是悄悄少渲染                                                                                                                                                                                                        |
| 搜索自建（构建期索引）                              | 不引入 Algolia 的第三方请求、查询词外发与前端 API key；纯前端匹配对博客量级足够                                                                                                                                                                                            |
| 嵌入块「构建期只出链接，运行期补数据」              | 构建期零网络、产物可复现；断网 / 禁 JS / 限流时仍是一条真链接                                                                                                                                                                                                              |
| `.vitepress` 放仓库根                               | 配置/主题与内容分离；`srcDir`/`outDir`/`cacheDir` 显式声明即可                                                                                                                                                                                                             |
| 中文也带 `/zh-cn/` 前缀                             | 与 `docs/zh-cn/` 一一对应，两种语言完全对称，无隐式映射；根路径只做语言分发                                                                                                                                                                                                |
| 高亮/任务列表自写插件，不装现成包                   | 两个包都无类型、`task-lists` 停更于 2018；自写零依赖，DOM 可控（详见 `support/markdown-plugins.ts` 顶部注释）                                                                                                                                                              |
| action 钉 40 位 SHA + 部署后冒烟                    | 防可变 tag 被改指；补「Actions 绿但线上坏」的盲区                                                                                                                                                                                                                          |
| `.gitattributes` 统一 LF                            | 避免 Windows `core.autocrlf` 让 `format:check` 本地红、CI 绿，以及 `fix` 整篇重写                                                                                                                                                                                          |

---

## 附：移动端设计约定

### 只有两种状态

| 状态      | 页头 | 悬浮胶囊       | 触发条件                                   |
| --------- | ---- | -------------- | ------------------------------------------ |
| `rest`    | 显示 | 展开成横向胶囊 | 顶部 160px 内 / 向上累计 60px / 程序化跳转 |
| `reading` | 隐藏 | 收成右下角圆   | 向下累计滚过 60px（未到页底）              |

状态由 `composables/useDockState.ts` 单一维护（模块级单例）。**不要**在组件里另起一套
滚动判定——会出现「页头藏了胶囊没缩」这类不一致。常量与滞回逻辑见第五节
「移动端：断点与 Dock 状态机」。

### 五个「看起来能改、其实会踩坑」的点

安全区 meta、`--dock-lift` 的 `max()`、胶囊右边缘的 `transform` 百分比、浮层的
`Teleport to="body"`、抽屉里只能用分段语言按钮——这五条与第五节「移动端」的硬约束是
同一份清单。

### z 轴阶梯（一句话）

只用 `tokens.css` 的命名令牌，自下而上是滚动条 90、页头 100、进度条 101、胶囊 102、
抽屉/目录 120、查看器 130、搜索 140、跳过链接 150；**禁止**就地写
`calc(var(--z-header) + N)`。完整阶梯与理由见 DESIGN.md §8。

---

## 附：阅读进度条、滚动锁与自绘滚动条

### 阅读进度条：属于页头，但用 fixed 定位

进度条是 `<header class="site-header">` 的**子元素**（`SiteHeader.vue` 里
`<ProgressBar v-if="isPost" selector="[data-article-body]" />`），定位用
`position: fixed`，`top: calc(var(--header-height) + var(--border-width))`。
页头的 `backdrop-filter` 和移动端 `transform` 会为 fixed 后代**创建包含块**，
所以进度条参照的是**页头自己**：桌面页头不动 → 贴在页头下沿；移动阅读态页头滑走 →
跟到屏幕顶端。一套 `top` 覆盖所有状态，没有分支。

两种错误改法（都别再试）：① 做成页头的兄弟元素——`is-hidden` 在桌面端也会被加上，
进度条会被顶到 `top: 0` 穿过页头；② 在移动端媒体查询里补
`.site-header.is-hidden .reading-progress { top: 0 }`——阅读态下包含块已经是页头，
再设 `top: 0` 会把进度条推到页头顶边（视口 -57px），直接飞出屏幕。
进度由 `useReadingProgress` 按正文区域（`[data-article-body]`）计算，不足一屏视为读完。

### 滚动锁：引用计数 + iOS 兜底

搜索、抽屉、目录浮层、查看器共用 `theme/support/overlay.ts` 的同一把锁：引用计数
（两处各自写 `body.style.overflow` 会互相清锁或锁死）；锁的是 `<html>`（`base.css`
的 `overflow-x: clip` 让 body 的 overflow-y 不再传播到视口）；iOS 额外固定 body 并记住
scrollY；解锁先用 `behavior: 'instant'` 归位再通知 `onScrollLockRelease`；组件卸载必须
释放（`releaseScrollLock` 有「计数不为负」保护，重复调用安全）。

### 滚动条：自绘，但只有页面级

页面级滚动条自绘（`components/common/ScrollBar.vue`），原生条被隐藏。
**完整规范见 [DESIGN.md](./DESIGN.md) 第十一节**（含自动隐藏的三个坑：初值必须
`-Infinity`、跳过 touch 指针、进出揭示带不刷新活动时间戳），这里只记实现相关的几件事。

**为什么不能挂进 `<header>`**：页头的 `backdrop-filter` 会为 fixed 后代创建包含块，
把滚动条关进页头的层叠上下文，`z-index` 就压不住正文了；所以它和页头**平级**，
都挂在 `PageShell`。

**长度下限与轨道上沿靠测量，不写死令牌**：轨道上沿取页头实测 `bottom`（阅读态下
`-57` 需夹到 0），长度下限取实测高度。不要改成 `--header-height`（布局契约，历史上
与实际高度漂移过）。**路由切换后必须重测**：`watch(route.path)` → `nextTick` →
`refresh()`；`ResizeObserver` 只覆盖「正文高度恰好变了」的副作用，不是契约。
`v-show` 管元素在不在树上、`is-shown` 管透明还是可见，**两层别合并**。
几何与显隐都是纯函数（`theme/support/scrollbar.ts`），有 23 个单测兜边界——
**改规则先改测试，再改实现。**
