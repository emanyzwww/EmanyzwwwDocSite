# 代码维护指南

**这份文档只讲一件事：怎么改代码。** 设计系统请读 [DESIGN.md](./DESIGN.md)，
写作请读 [WRITING.md](./WRITING.md)。

> **改任何视觉相关的东西之前，先读 [DESIGN.md](./DESIGN.md)。**
> 那里是配色、排版、圆角、阴影、间距的**唯一准绳**；
> `theme/styles/tokens.css` 只是它的实现。本文档负责「改哪儿」，
> DESIGN.md 负责「为什么是这样」。

目录：

1. [心智模型：一次构建发生了什么](#一心智模型一次构建发生了什么)
2. [目录职责表](#二目录职责表)
3. [改站点配置](#三改站点配置)
4. [改样式](#四改样式)
5. [改组件](#五改组件)
6. [标签与路由](#六标签与路由)
7. [加功能：任务清单](#七加功能任务清单)
8. [删功能：反向操作](#八删功能反向操作)
9. [格式化与类型检查](#九格式化与类型检查)
10. [部署](#十部署)

---

## 一、心智模型：一次构建发生了什么

理解这条链路，绝大多数「该改哪儿」的问题就不用查文档了。

```text
docs/{zh-cn,en}/**/*.md          ← 内容按语言分目录，URL 前缀即目录名
    │
    │  ① support/content.ts 扫描全部 .md，解析 frontmatter
    │     算出：url / 标题 / 摘要 / 字数 / 标签 / 日期文本 / 语言
    ▼
data/posts.data.ts  ──►  PostSummary[]  ──►  序列化成 JSON 内联进客户端
    │
    │  ② 同时：docs/<locale>/{tags,posts}/**/index.paths.ts 用同一份数据
    │     生成动态路由（每个标签一页、每个分页一页）
    ▼
config.ts
    │  ③ 给每页补 title/description（transformPageData）
    │     补 canonical / OG / RSS（transformHead）
    │
    │  ③.5 图片管线（support/media/，Vite 插件）
    │     buildStart 预扫全部 .md 的图片引用 → sha256 → sharp 转多档 webp
    │     markdown.config 里的 mediaMarkdown 把图渲染成 <figure> + srcset
    │     generateBundle 用 emitFile 把变体与原图写进产物
    ▼
theme/Layout.vue
    │  ④ 按 frontmatter.layout 选页面组件
    │     composables 读 posts.data 的 JSON，算标签/分页/上下篇
    ▼
Vue 组件  ──►  HTML（图片已是 <figure>，点击由 useImageViewer 接管）
    │
    │  ⑤ buildEnd 用同一份数据再生成 RSS 与 robots.txt
    ▼
.vitepress/dist/
```

**三条重要结论**：

1. **文章数据只有一个来源**：`support/content.ts`。列表、标签、RSS、统计卡看到的是同一份，
   所以不会出现「列表里有、标签页没有」这种不一致。
2. **`support/` 是构建期（Node）代码，`theme/` 是运行期（浏览器）代码**。
   前者可以 `import 'node:fs'`，后者不行。
3. **数据在构建期算好，客户端零计算**。加字段要改 `types.ts` + `content.ts`，不是改组件。

---

## 二、目录职责表

```text
.vitepress/                 ← 配置与主题在仓库根，与内容分离
├─ config.ts              构建配置：路由、Markdown、SEO、RSS。改「站点行为」看这里
├─ types.ts               全站类型。加字段先改这里，TS 会告诉你哪儿还没适配
├─ env.d.ts               import.meta.glob 与 .vue 的类型声明
│
├─ data/                  纯数据与数据加载器（*.data.ts 是加载器）
│  ├─ site.ts             ★ 站点名、域名、导航、页脚、分页数、侧栏顺序、语言表
│  ├─ frontmatter.ts      ★ 文章 frontmatter 的字段表（命令与内容管线共用）
│  ├─ profile.ts          ★ 个人信息、头像、社交链接
│  ├─ widgets.ts          ★ 自定义侧栏卡片内容
│  ├─ taxonomy.ts         标签 slug / 显示名覆盖（可选）
│  ├─ posts.data.ts       → 文章摘要数组
│  ├─ pages.data.ts       → 全部页面路径（语言切换用）
│  ├─ profile.data.ts     → 渲染好的 bio HTML
│  └─ widgets.data.ts     → 渲染好的卡片 HTML
│
├─ support/               构建期 Node 工具（不能在浏览器里跑）
│  ├─ content.ts          ★ 扫描/解析 Markdown，文章的唯一定义处
│  ├─ format.ts           日期/字数/截断（纯函数，两端通用）
│  ├─ markdown/           ★ Markdown 装配点（见「块级指令」专节）
│  │  ├─ index.ts         applySiteMarkdown()：页面正文与非页面共用同一套插件
│  │  ├─ directives/      块级指令 `:::github` 等（注册表 / 解析 / 规则 / 实现）
│  ├─ markdown-plugins.ts 自写行内语法：`==高亮==`、GFM 任务列表
│  ├─ media/              ★ 图片管线（见下方专节）
│  │  ├─ planner.ts       纯函数：格式裁决、档位、命名、base 拼接（可单测）
│  │  ├─ probe.ts         同步读图片头部尺寸（零依赖，可单测）
│  │  ├─ registry.ts      源路径 → 产物清单；sha256 去重；按需转码
│  │  ├─ transcode.ts     唯一 import sharp 的文件；磁盘缓存
│  │  ├─ render.ts        markdown 侧：figure 提升 + 图片渲染
│  │  ├─ runtime.ts       运行期上下文单例（base / 模式 / 目录）
│  │  └─ vite.ts          Vite 插件：预扫 / emitFile / dev 中间件
│  ├─ rss.ts              RSS 生成（buildEnd 调用）
│  ├─ robots.ts           robots.txt 生成（buildEnd 调用）
│  └─ dev-redirect.ts     dev 下 `/` 按 Accept-Language 跳语言
│
├─ dist/                  构建产物（gitignore）
├─ cache/                 Vite 依赖缓存 + 图片转码缓存（gitignore）
│
└─ theme/                 运行期代码（浏览器）
   ├─ index.ts            主题入口：引样式 + 路由过渡 + 锚点滚动 + 复制按钮本地化
   ├─ Layout.vue          ★ 按 frontmatter.layout 分发页面组件
   ├─ i18n/               界面文案（zh-cn / en / index）
   ├─ composables/        组合式函数：文章、标签、分页、目录高亮、进度条、语言、移动端状态、图片查看器、★ 浮层进出状态机（usePresence）
   ├─ components/
   │  ├─ pages/           ★ 六个页面级组件（Home/Posts/Doc/Tags/Tag/NotFound）
   │  ├─ layout/          外壳：PageShell、TwoColumn、ThreeColumn
   │  ├─ site/            页头、页脚、导航、搜索面板、主题切换、语言切换
   │  ├─ mobile/          移动端专属：导航抽屉（MobileNav）、悬浮胶囊（MobileDock）
   │  ├─ post/            文章卡片、时间线、元信息、上下篇、分页
   │  ├─ tag/             标签云、标签分组、其他标签
   │  ├─ aside/           侧栏：容器 + 7 个卡片组件（注册表里可选 4 种）
   │  └─ common/          图标、空状态、进度条、★ 图片查看器（ImageViewer）
   ├─ support/            浏览器侧工具：图标表、路径、媒体、分页、滚动、浮层（滚动锁 / 焦点陷阱 / 关闭登记表）、★ 路由过渡、★ 锚点滚动、★ 主题过渡
   └─ styles/             13 个分层样式（含 lightbox.css 与 route-transition.css）

docs/                      ← 只有内容
├─ zh-cn/                 中文站（URL `/zh-cn/`）
│  ├─ index.md            首页（layout: home）
│  ├─ about/index.md
│  ├─ posts/              文章（含 page/[page]/ 分页动态路由）
│  └─ tags/               标签总览 + [tag]/ 动态路由
└─ en/                    英文站（URL `/en/`），结构完全对应

scripts/                   ← 命令行脚本（内容侧工具，不参与构建）
├─ run.ts                 统一入口：按命令名分发，并提供统一的参数与错误处理
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
   ├─ frontmatter.ts      frontmatter 的解析与序列化（保持仓库写作风格）
   ├─ posts.ts            文章路径解析与收集
   ├─ create.ts           建目录、分配序号、生成 slug
   ├─ args.ts             命令行参数解析
   └─ ui.ts               颜色、按显示宽度对齐、表格

media/                     ← 会换的图（头像等），走 Vite 指纹
public/                    ← 原样拷贝：favicon、根路径语言跳转页
```

带 ★ 的是**日常最常改的**。

> `.vitepress` 在仓库根而不是 `docs/` 里，因此 `config.ts` 必须显式声明
> `srcDir: 'docs'`、`outDir: '.vitepress/dist'`、`cacheDir: '.vitepress/cache'`。
> 否则 VitePress 会按命令行传入的 root（`.`）解析成 `./dist`、`./cache`。
>
> `public/` 同理：Vite 的 `publicDir` 相对 root（= `srcDir`）解析，默认会去找
> `docs/public`。因此配置里用**绝对路径**指向仓库根的 `public/`
> （`fileURLToPath(new URL('../public', import.meta.url))`），
> 否则 favicon 与根路径跳转页都不会进产物。

### 三类 `support/` 与 `lib/` 的区别（容易混）

|                | `.vitepress/support/`                  | `.vitepress/theme/support/` | `scripts/lib/`             |
| -------------- | -------------------------------------- | --------------------------- | -------------------------- |
| 运行环境       | 构建期（Node）                         | 浏览器                      | 命令行（Node）             |
| 能用 `node:fs` | ✅                                     | ❌                          | ✅                         |
| 典型内容       | 读文件、生成 RSS                       | 路径拼接、图标表、滚动监听  | 参数解析、建文章、终端输出 |
| 被谁引用       | `config.ts`、`*.data.ts`、`*.paths.ts` | Vue 组件                    | `scripts/*.ts`             |

例外：`format.ts` 在构建期目录里，但它是纯函数，两边都能用。

**脚本为什么不自己定义一套站点常量**：语言的权威定义在 `.vitepress/data/site.ts`，
frontmatter 字段的权威定义在 `.vitepress/data/frontmatter.ts`。
`scripts/lib/site.ts` 只是把前者**再导出**给命令行用，一个字都不复制——
否则加一门语言、加一个 frontmatter 字段时，构建期与命令行会各说各话。

---

## 三、改站点配置

### `data/site.ts` —— 站点层面的一切

```ts
const SITE_URL = 'https://emanyzwww.github.io' // 站点 origin（sitemap / RSS 用）
const SITE_NAME = 'EmanyzwwwDocSite' // 品牌名（页头 / 页脚 / 标题后缀）
const TIME_ZONE = 'Asia/Shanghai' // 日期显示时区

export const SITE: SiteMeta = {
  postsPerPage: 10, // 每页文章数
  homePostCount: 5, // 首页显示几篇
  recentPostsLimit: 5, // 侧栏「最近文章」几条
  tagSuggestLimit: 20, // 标签页底部「其他标签」几个
  tagPreviewCount: 3, // 标签总览页每个标签预览几篇
  outline: true, // 是否生成右栏目录（全局开关）
  wordCount: true, // 是否显示字数
  widgets: ['profile', 'tags', 'custom'], // 侧栏卡片顺序
  footer: {/* 版权、附加文字、链接 */},
}
```

> `SITE_URL` 必须是**真实可访问**的 origin：sitemap、canonical、RSS 的绝对链接
> 全部由它派生。之前这里写的是一个没有 DNS 记录的域名，导致本地构建产物的
> 绝对链接全是死链，只有 CI 里 `VP_SITE_URL` 覆盖后才正确。
> 部署到子路径时这里只写 origin，子路径由 `base` 单独处理。

**改这里能立刻看到效果**：

| 想改          | 改哪个字段         |
| ------------- | ------------------ |
| 站点名 / 品牌 | `SITE_NAME`        |
| 换个域名      | `SITE_URL`         |
| 每页文章数    | `postsPerPage`     |
| 首页显示几篇  | `homePostCount`    |
| 全站关掉目录  | `outline: false`   |
| 全站关掉字数  | `wordCount: false` |
| 侧栏顺序      | `widgets` 数组     |
| 页脚链接      | `footer.links`     |
| 版权起始年    | `since`            |
| 导航菜单      | `NAV` 对象         |
| 语言列表      | `LOCALES` 对象     |
| 默认语言      | `DEFAULT_LOCALE`   |

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

**根路径 `/` 不承载内容**：`public/index.html` 会按浏览器语言跳到
`/zh-cn/` 或 `/en/`，匹配不上时落到 `DEFAULT_LOCALE`；用户在语言按钮上手动选过的
语言记在 `localStorage`（键 `emanyzwww-locale`），优先级高于浏览器语言。
dev 阶段由 `.vitepress/support/dev-redirect.ts` 用 `Accept-Language` 做同样的跳转。

### 改导航

```ts
export const NAV = {
  'zh-cn': [
    { text: '首页', link: '/zh-cn/' },
    { text: '文章', link: '/zh-cn/posts/' },
    { text: '标签', link: '/zh-cn/tags/' },
    { text: '关于', link: '/zh-cn/about/' },
  ],
  en: [/* 英文版 */],
}
```

- `link` 用**目录式路径**（`/zh-cn/posts/`），不要写 `.html`，不要写相对路径
- 两种语言的 link 都必须带各自的语言前缀，与 `docs/<locale>/` 目录一一对应
- 高亮自动判断：当前路径等于该项或以该项为前缀
- 首页特殊处理：只做精确匹配，否则所有页面都会点亮首页
- 加一项就是加一行；**英文和中文要分别加**

### `data/profile.ts` —— 个人信息

```ts
export const PROFILE: Profile = {
  avatar: 'avatar.png', // media/ 下的文件名
  name: 'Emanyzwww',
  tagline: '余晏舟',
  bio: '支持 Markdown',
  links: [{ label: 'GitHub', url: 'https://...', icon: 'github' }],
  tagsLimit: 20, // 侧栏标签卡上限
}
```

`icon` 可选值见 `types.ts` 的 `IconName`；加新图标要改 `theme/support/icons.ts`（见第五节）。

### `config.ts` —— 构建行为

| 想改           | 位置                                                                             |
| -------------- | -------------------------------------------------------------------------------- |
| 代码高亮主题   | `markdown.theme`（当前 `github-dark-default`）                                   |
| 目录收几级标题 | `markdown.headers.level`（当前 `[2, 3]`，可加 4）                                |
| 草稿目录       | `srcExclude`（当前含 `**/_drafts/**`）                                           |
| 锚点跳转偏移   | `scrollOffset`（当前 80；仅影响跨页 hash 定位，页内滚动读 `scroll-padding-top`） |
| 站点地图域名   | `SITEMAP_HOSTNAME`（自动 = 站点 origin + `VP_BASE`）                             |
| 页头 meta      | `head` 数组                                                                      |
| 页面标题怎么拼 | `transformPageData`                                                              |
| OG / RSS 标签  | `transformHead`                                                                  |
| RSS 生成逻辑   | `buildEnd` → `support/rss.ts`                                                    |
| robots.txt     | `buildEnd` → `support/robots.ts`                                                 |

### 部署路径

`config.ts` 里两个环境变量：

```ts
const BASE = process.env.VP_BASE ?? '/' // 部署根路径
const SITE_URL = process.env.VP_SITE_URL ?? SITE.url // 绝对地址
```

CI 会自动算好这两个值传给构建（见 `.github/workflows/deploy.yml`）。本地不用管。

**坑：sitemap 的 `hostname` 必须包含 `BASE`。** VitePress 用
`new URL(page.url, hostname)` 拼绝对地址，而 `page.url` 是 `about/` 这类相对路径；
若 `hostname` 只有 origin，`/repo/` 会被 URL 解析吃掉，项目站点的 sitemap 会全部
指向域名根。`SITEMAP_HOSTNAME` 就是为此存在的，`robots.txt` 也复用它。

`BASE` 现在还有第二个用处：**图片 URL 要自己拼 base**（见下面的图片管线）。
原因是 `config.ts` 关掉了 `vue.template.transformAssetUrls` 对绝对路径的改写。

---

## 三·五、图片管线（`support/media/`）

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
| `assets/media/orig/<sha12>.<ext>` | 原图，**原始字节**，不重新编码         |

`sha12` 是**源文件字节 sha256 的前 12 位**。同一个键带来三个能力：

1. **跨文章 / 跨语言去重**：中英各放一份相同的图 → 产物只有一套；
2. **缓存失效**：换图 → sha 变 → URL 变 → 浏览器当新文件下载；
3. **不依赖 Vite 的哈希**：文件名由我们算，Vite 不再参与。

### 档位怎么定

`planner.ts` 的 `ladderWidths`：

- 固定出 **336 / 672 / 1008**（对应窄屏 @1x、桌面 @1x、窄屏 @3x）
- **永不放大**：大于等于源宽的档直接丢弃
- **补一档原宽**（超过 2016 则补 2016）：否则 1200px 的图在 2× DPR 下只能用 1008
- `sizes` 是 `(min-width: 704px) 672px, calc(100vw - 32px)`
  —— **704 = 672 + 两侧各 16px**，不是页头那个 720 断点

矢量（svg）不出档位，动图（gif）只出一档并转 animated webp。

### 为什么必须关掉 `transformAssetUrls` 的绝对路径改写

`config.ts` 里有：

```ts
vue: {
  template: {
    transformAssetUrls: {
      includeAbsolute: false
    }
  }
}
```

不关的话，`<img src="/assets/media/<sha>-672.webp">` 会被 `@vitejs/plugin-vue`
改写成 ESM import，Vite 去找这个文件，结果是二选一：

- 找不到 → `Rollup failed to resolve import`，构建**直接失败**；
- 恰好存在 → 被 Vite **按内容重新哈希**，我们算的指纹作废、产物里多一份副本。

关掉之后相对路径**仍然**会被 import —— 这是好事：作者写错相对路径时依旧在
构建期 hard fail，而不是静默产出一个 404 的 URL。

### 构建期与 dev 的差异（唯一的差异是"何时转码"）

| 阶段                     | 做什么                                                      |
| ------------------------ | ----------------------------------------------------------- |
| build / `buildStart`     | 预扫全部 `.md` 的图片引用 → 批量转码 → `assertReady()` 校验 |
| build / `generateBundle` | `emitFile` 把变体与原图写进产物（**只 client build**）      |
| dev / `configureServer`  | 中间件按需转码，URL 与构建期完全同构                        |

三个必须记住的坑：

1. **VitePress 会跑两次 Vite build**（client + SSR）。SSR 的 outDir 是 `.temp`
   且结束即删，所以 `emitFile` 只在 `config.build.ssr === false` 时做。
2. **dev 中间件必须注册在 `configureServer` 函数体里**，不能放在返回的后置钩子里
   —— 后者排在 SPA fallback 之后，`req.url` 已被改写成 `/index.html`。
   注册在函数体里时 `req.url` **仍带 base**，要自己剥。
3. **dev 必须 `Cache-Control: no-store`**。VitePress 的 md 渲染缓存键只有
   `{src, file}`，改了图但 md 没变时 URL 不会变；靠禁缓存保证你看到的是新图。

### 缓存

转码结果缓存在 `.vitepress/cache/media/`（已被 `.gitignore` 与 `.oxfmtignore`
同时忽略）。缓存键包含：

```text
源 sha256 | 宽度 | 参数(quality/effort) | PIPELINE_VERSION | platform | libvips 版本 | webp 版本
```

**后三项不能省**：Windows 与 Linux 的 libvips 构建不同，少了平台/版本项，
本地产物会被 CI 的缓存悄悄冒充，出现「本地对、线上不对」这种最难查的故障。

改了编码参数、档位算法或命名规则，**必须把 `transcode.ts` 的 `PIPELINE_VERSION` +1**，
否则缓存会继续返回旧参数产出的字节，且没有任何提示。

### LQIP（图片加载前的色彩占位）

位图在转码时**额外**产出一张 20px 宽的模糊 webp（`<sha12>-lqip.webp`，
几百字节），构建期直接 base64 内联进 `<img data-lqip="data:image/webp;base64,…">`。
它**不作为独立 URL 被引用**、不进 `generateBundle` 发射——内联是为了
「占位与 `<img>` 同请求到达」，走网络就失去意义。

运行期三层占位（`content.css` 的 prose-media 一节）：

```text
① shimmer 骨架（link 的流动渐变背景，只在有 LQIP 的图上启用）
② LQIP（img 的 background，data URI，解析到标签即有）
③ 真图淡入（theme/index.ts 的捕获式 load 委托打 data-loaded）
```

关键实现约束：

1. **`load` 事件不冒泡**——`data-loaded` 的委托必须挂在 `document` 上且
   用捕获阶段（`addEventListener('load', fn, true)`），这是 `theme/index.ts`
   里 `markLoadedImages` 的做法，与 lightbox 的点击委托同一个模式；
2. LQIP 的转码失败**静默降级**（返回 `null`，渲染侧跳过属性）——它是体验
   增强，绝不能弄挂构建；
3. 矢量（svg）与窄于 20px 的图不出 LQIP；
4. 查看器（lightbox）复用同一套三层占位：`useImageViewer.collectGallery()`
   从正文 `<img data-lqip>` 把占位带进画廊项，加载态样式在 `lightbox.css`。

### 链接悬浮预览（provider 注册机制）

正文链接悬浮 300ms 后弹出预览卡（`LinkPreviewCard.vue` + `useLinkPreview.ts`），
键盘 focus 同样触发（150ms）。数据按 **provider 注册表** 分发
（`theme/support/link-preview/`）：

```text
core.ts        纯函数：URL 解析（GitHub repo / bilibili BV号）、缓存键、TTL、域名兜底卡
providers.ts   provider 注册表：站内 → GitHub → bilibili → 通用外链（顺序即优先级）
```

**依赖注入是硬约束**：`createProviders({ posts, messages })` 由 `PageShell`
在 **setup 期间**调用（posts / messages 内部走 `inject()`，离开 setup 会抛错），
响应式引用被闭包捕获进 provider，悬浮回调里只读 `.value`。
不要在 provider 的 fetch 里直接调 `usePosts()` / `useI18n()`。

**跨域是硬约束**：provider 要在浏览器里 fetch 第三方 API，对方必须返回
CORS 头（`Access-Control-Allow-Origin`）。没有 CORS 的接口（如 bilibili 的
web 接口，带 `Origin` 即 403）在纯静态站上无解——JSONP 会被 CSP
`script-src` 拦截——只能走同源代理（如 Cloudflare Pages Functions，代理是
同源请求，CSP 不用改）或降级成不发请求的域名卡（bilibili 现状，
`fallbackSite: 'bilibili'`）。判断方法：F12 → Network → 看响应有没有 CORS 头。

**新增一种链接类型**（以知乎为例）：

1. `core.ts` 加一个 `parseZhihuAnswer(url)` 之类的纯解析函数（可单测）；
2. `providers.ts` 写一个 `LinkProvider`（`id` / `match` / `fetch`，
   可选 `fallbackSite`），插进 `createProviders()` 的合适位置；
   fetch 必须带超时、拿不到返回 `null`（调用方会自动降级成 `fallbackSite`
   域名卡，卡片永不空白）；
3. 确认 API 有 CORS 后，`config.ts` 的 CSP `connect-src` 加上 API 域名——
   **漏了这步 fetch 会被静默拦截**，表现为永远降级成通用域名卡；
4. 需要站点图标就在 `icons.ts` + `types.ts` 的 `IconName` 里加一个，
   并把名字加进 `LinkPreviewCard.vue` 的 `PREVIEW_ICONS` 白名单。

缓存：内存 Map + `localStorage`（键 `emanyzwww-link-preview:<provider>:<url>`），
TTL 24 小时（`PREVIEW_TTL_MS`）。同一链接重复悬浮零请求；拿不到的结果
（`data: null`）同样进缓存，TTL 内不反复重试。用户悬浮触发请求只会
把「读者在看哪个链接」发给对应平台——TTL 去重就是隐私上的克制手段。

**没有通用外链兜底**（作者拍板）：普通外链悬浮不弹卡。域名卡信息量为零
且观感差，不认识的链接保持安静比弹出「example.com」更得体。

### 块级指令（`:::github` 等）

**这是本站唯一的块级扩展入口**，实现在 `support/markdown/`：

```text
support/markdown/
├─ index.ts              applySiteMarkdown()：装配点（页面正文与非页面共用）
├─ directives/
│  ├─ registry.ts        类型、注册表、未知指令的报错（含拼写纠错）
│  ├─ parse.ts           :::name 参数行的纯字符串解析
│  ├─ block.ts           markdown-it block 规则（找配对围栏、递归内部 Markdown）
│  ├─ builtins.ts        四个指令的实现（github / link / figure / quote）
│  └─ index.ts           installDirectives()
└─ markdown-plugins.ts   （在上一级）行内语法：==高亮== 与任务列表
```

**四条不可协商的纪律**（写在 `registry.ts` 顶部，改动前先读）：

1. **构建期禁止任何网络请求**。指令的 `open()` / `close()` 必须同步、纯函数。
   有测试守着：`tests/offline-build.test.ts` 会把 `fetch` 换成抛错并真的跑一次构建。
2. **禁止「先占位、稍后改写」**。指令一旦渲染就是终态，没有任何后续阶段再动产物。
3. **基线必须可用**。断网 / 禁 JS / 接口失败时，读者看到的仍是一条真链接。
4. **未注册的指令必须报错**，并列出可用类型——静默降级成本文会让作者以为语法生效了。

#### GitHub 仓库卡：构建期只出链接，数据在浏览器补

这是与改造前**最大**的差别，值得完整理解：

```text
构建期（同步、零网络）
  :::github vuejs/core
  → <div class="embed embed--github" data-embed="github" data-target="vuejs/core">
      <a class="embed__link" href="https://github.com/vuejs/core">
        <span class="embed__head">
          <span class="embed__repo"><strong>vuejs</strong>/core</span>
          <span class="embed__site">GitHub</span>
        </span>
      </a>
    </div>

运行期（theme/embeds/enhance.ts）
  IntersectionObserver 进入视口 200px 内 → fetch api.github.com/repos/vuejs/core
  → 成功：往 <a> 里 head 之后追加 .embed__desc 与 .embed__meta
  → 失败：什么都不做（基线链接本来就能用）
```

**为什么必须这样**（这是旧实现踩过的四个坑，逐条对应）：

| 旧实现                                                                  | 后果                                                                          |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 渲染期同步拿不到数据 → `buildEnd` 异步抓取后用正则改写 `dist/**/*.html` | 构建依赖网络，断网/限流时产物不可复现                                         |
| 改写只覆盖 `.html`，覆盖不到客户端路由用的 `.js` chunk                  | 首屏卡片是新的、站内跳转是旧的，同一页两种渲染                                |
| `String.replace` 只替换首处                                             | 同一仓库在页面上出现多次时，第 2 张起不被改写，且 `data-repo-card` 泄漏进源码 |
| 抓取失败输出 `github-card--pending`（无对应 CSS）                       | 读者看到半张空卡，而不是普通链接                                              |

运行期增强的三条实现纪律（`theme/embeds/enhance.ts` 顶部有详细说明）：

- **只加不改结构**：只往 `.embed` 容器内部追加节点，容器本身与它所在的位置永不动。
  这避免了又一次 hydration mismatch（旧卡片把 `<p>` 放进 `<a>` 里，浏览器把一张卡
  拆成三个链接，Vue 直接报 `Hydration completed but contains mismatches`）。
- **懒加载**：滚动接近才请求，一屏十张卡不会发十次。
- **去重 + 缓存**：同 URL 并发共用一个 Promise；结果进 `localStorage`（TTL 24h）。

卡内**所有文字容器必须是 `<span>`**，不能用 `<p>`：`<a>` 里放 `<p>` 会被浏览器
按规范拆开。这条由 `tests/directives.test.ts` 的「产出不含 `<p>`」用例守着。

#### 新增一个指令

1. 在 `directives/builtins.ts` 写一个 `Directive`（`name` / `summary` / `example` /
   `body` / `open()` / `close()`），加进 `DIRECTIVES`；
2. `body: 'none'` 表示不吃内部内容（渲染成整块 HTML）；`'markdown'` 表示内部
   照常解析，产物夹在 `open()` 与 `close()` 之间；
3. 需要运行期数据就在 `theme/embeds/` 加一个增强器，并在 `open()` 里输出
   `data-embed="你的名字"` 作为钩子；
4. 样式加到 `content.css` 的「嵌入块」一节，DOM 契约写在该节注释里；
5. 补 `tests/directives.test.ts` 用例（正常形态 + 缺参数 + 未知参数）。

**不要**在指令里读文件系统或网络——那会让 `tests/offline-build.test.ts` 直接失败。

#### 已知限制：指令不能直接放进 VitePress 内置容器

```markdown
::: tip 这样会失败
:::github vuejs/core
:::

:::
```

**原因**：内置容器（`tip` / `info` / `warning` / `danger` / `details` / `code-group`）
和本站指令**共用 `:::` 围栏**。内置容器由 VitePress 自己的插件处理（在我们的规则之前），
它把遇到的第一个 `:::` 当成自己的闭合行——于是内层指令永远等不到收尾行。

**为什么不在指令层修**：`markdown.config` 是 VitePress 留给用户的**最后**一道钩子，
内置容器的块级规则已经先于我们注册，它先吃掉围栏，我们看不到它内部发生了什么。

**当前处理**：构建会失败，并在报错里明确写出「这个指令位于 VitePress 内置容器（tip）内部」
和「把指令移到容器外面」。作者不会对着"明明写了 :::"发愣。

**绕过办法**：**让外层的围栏比内层长**。外层容器写 4 个冒号，内层指令保持 3 个。实测可用：

```markdown
:::: tip 容器
:::github vuejs/core
:::
::::
```

规律：`:::` 的**数量决定配对**，内层必须比外层短。VitePress 的容器规则只认
「整行只有冒号、且长度 ≥ 自己」的行做闭合，所以外层 `::::` 不会被内层的 `:::` 提前关掉。

> 早期版本的说明写反了（说内层要写 `::::`）——那是错的，实测会报"没有闭合"。
> 正确的做法是**加长外层**。

### 改图片管线时的检查清单

```text
□ pnpm test                     纯函数单测（档位/命名/头部探测/figure 边界）
□ pnpm build                    看 dist/assets/media/ 是否按预期出档
□ 同一张图放中英两个目录        产物里应只有一套变体
□ 故意放一张 .bmp               构建应失败且提示"另存为 PNG"
□ pnpm dev 打开文章             图片应能显示（走 dev 中间件）
□ 点开图片                      查看器应能翻页/缩放/下载原图
```

---

## 四、改样式

### 三层令牌制度

**核心规则：其他 CSS 只引用变量，不写死数值。**
令牌的**规范准绳是仓库根的 [DESIGN.md](./DESIGN.md)**，`tokens.css` 只是它的实现。

`theme/styles/tokens.css`：

```css
/* 1. 原始层：颜色本身 */
:root {
  --gray-900: #0c0f0e;
  --teal-600: #0f766e;
}

/* 2. 语义层：按用途命名，明暗主题在这里切换 */
:root {
  --bg-canvas: var(--gray-25);
  --fg-default: #14181a;
  --accent: var(--teal-600);
  --border-subtle: var(--gray-150); /* 装饰 */
  --border-control: var(--gray-300); /* 控件，需 ≥ 3:1 */
}
.dark {
  --bg-canvas: var(--gray-900);
  --fg-default: #e8eae8;
  --accent: var(--teal-300);
}

/* 3. 排版 / 间距 / 圆角 —— 不随主题变 */
:root {
  --text-md: 1.0625rem; /* 正文 17px */
  --space-4: 1rem;
  --radius-lg: 20px;
  --layout-max: 82rem;
  --layout-measure: 42rem;
  --aside-width: 16rem;
}
```

### 五条设计纪律（违反会破坏整体气质）

改任何视觉相关的东西之前，先确认不违反这五条。理由都在 DESIGN.md 里。

1. **卡片默认无阴影。** 阴影只给需要遮挡内容的浮层
   （抽屉 / 目录 / 搜索 / 胶囊 / 下拉菜单）。
   判断标准一句：_如果元素需要遮挡下方内容，它才有阴影。_
   所以卡片悬停**不上浮、不加投影**，只改描边与底色。
2. **层次靠表面色差，不靠边框。** 相邻区域用
   `--bg-canvas` / `--bg-surface` / `--bg-surface-alt` 区分。
3. **字重只用 400 / 600 / 700。** 刻意不用 500 —— 它在中文字体里与 400
   几乎无差别，只会制造「好像强调了但不确定」的模糊感。
   `--weight-medium` 只是指向 400 的兼容别名，**不要再用**。
4. **标题上方空间必须明显大于下方**（h2 是 48:16）。把标题「绑」到它下面
   的内容上，是排版里效果最明显的一条。
5. **圆角只用六档，不在组件里现算。** 嵌套时内层半径 = 外层半径 − 内边距
   （同心圆规则）。

### 改配色后必须做的事

```bash
# 1. 对比度实测（打印每个前景/背景组合，必须全部 PASS）
node .dsh/temp/contrast.mjs

# 2. 令牌完整性（确认没有「引用了未定义令牌」）
node .dsh/temp/check-tokens.mjs
```

> 两个脚本都在 `.dsh/temp/` 下，该目录**不进版本库**（`.gitignore` 里的 `temp/`）。
> 换台机器需要重新生成：`contrast.mjs` 直接读 `tokens.css` 解析变量链，
> 所以只要令牌还在，它就是准确的。

`check-tokens.mjs` 会报两类问题：

- **[x] 被引用但未定义** → 必须修，否则那条样式直接失效；
- **[!] 定义了但未被引用** → 通常是**有意保留**的，不必强求清零：
  - 完整色阶（`--teal-100/500/800`、`--gray-600/950`、`--amber-300`）——
    中间档位留着备用，不是每种都要被用到；
  - 语义别名（`--weight-medium` → 400、`--black`）——
    为了让含义显式，不代表要有消费者；
  - 预留档位（`--space-24`）—— 大间距，将来做落地页会用到。

  只有当某个令牌**本应被使用却被遗忘**时才算问题（那时你会在页面上直接看出异常）。

`contrast.mjs` 里把边框分成了两类，这个区分很重要：

- `--border-subtle` / `--border-strong` 是**装饰**（卡片描边、分隔线），
  WCAG 1.4.11 不约束它们；
- `--border-control` 是**控件边界**（输入框、按钮、分页），必须 ≥ 3:1。

把装饰边框也压到 3:1，整个界面会变成一堆灰框，反而削弱真正的控件边界。

### 样式特异性的两个坑（都踩过）

1. **兜底规则可能压过具体规则。** `.prose > div > div > * + *` 的特异性是
   (0,1,2)，比 `.prose h2` 的 (0,1,1) 高 —— 于是 h2 的 48px 上间距被
   通用的 20px 覆盖，**整站标题节奏从未生效**。修法：给兜底规则包
   `:where()` 把特异性降到 0。
2. **去掉链接下划线要显式写。** `base.css` 给所有 `a` 加了常驻下划线
   （色盲用户的非颜色提示）。块级导航链接（`.m-nav__link`、
   `.locale-seg__btn`、`.site-nav a`、`.card` 内部链接等）必须自己
   写 `text-decoration: none`，否则会出现「导航项被下划线穿过」的观感。

### 常见改动

| 想改     | 改哪个变量                                           |
| -------- | ---------------------------------------------------- |
| 强调色   | `--teal-*` 色阶（明暗各映射一次）                    |
| 画布色调 | `--gray-25`（浅）/ `--gray-900`（深）                |
| 圆角风格 | `--radius-xs/sm/md/lg/xl/full`（六档）               |
| 整体字号 | `--text-*`（正文是 `--text-md` = 17px）              |
| 间距节奏 | `--space-*`（4px 基准）                              |
| 正文字体 | `--font-sans` / `--font-mono`                        |
| 主体宽度 | `--layout-max`                                       |
| 正文行宽 | `--layout-measure`（当前 42rem ≈ 39 汉字/行）        |
| 侧栏宽度 | `--aside-width`                                      |
| 页头高度 | `--header-height`（改后注意 `scrollOffset`）         |
| 层级     | `--z-*` 命名阶梯，**禁止** `calc(var(--z-header)+N)` |
| 滚动条色 | `--scrollbar-thumb*`（三档：静止/悬停/拖拽）         |

### 明暗主题的机制

VitePress 通过给 `<html>` 加 `.dark` 类切换。所以：

```css
/* ✅ 正确：用语义变量，两套自动生效 */
.card {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
}

/* ❌ 错误：写死颜色，深色主题下会瞎 */
.card {
  background: #fff;
  border: 1px solid #e4e6eb;
}

/* 需要针对某个主题微调时 */
.dark .card {
  box-shadow: none;
}
```

**不要用 `[data-theme="dark"]`** —— 那是旧 Hugo 站的写法，本站不生效。

**深色主题不是浅色的反相**，是独立设计的一套：表面不用纯黑（纯黑会让卡片
边界消失）、卡片比画布**亮**（深色下阴影几乎不可见，靠亮度表达层次）、
强调色换成浅色版（`#0f766e` 在深底上只有 2.1:1，完全不可读）。
因此**新增颜色必须两套都写**。

### 样式分三层：共用两层，独立一层

这是理解整个样式系统的关键。**站点外壳与文章正文不是完全独立的两套系统，
而是「共用底层令牌、各自独立的排版层」**：

```text
┌─ ① 令牌层（共用）
│    tokens.css —— 颜色 / 字号 / 间距 / 圆角 / 阴影 / 动效 / 层级
│    改 --accent 会同时影响外壳和正文，这是刻意的
│
├─ ② 外壳层（chrome）
│    base / layout / components / posts / widgets / mobile / search
│    只管页头、页脚、卡片、导航、时间线……**不碰正文排版**
│
└─ ③ 正文层（独立命名空间）
     content.css —— 全部规则挂在 `.prose` 下，只作用于 Markdown 渲染结果
```

**为什么正文要独立（三个实际理由）：**

1. **Markdown 是外部输入。** 正文 DOM 由 VitePress 从用户写的 `.md` 生成，
   我们控制不了它的 class。只能靠 `.prose` 作用域隔离——否则「给文章 h2
   加下边框」会连带把侧栏卡片的 h2 也改掉。
2. **密度需求相反。** 外壳要紧凑（14px 为主，一屏放更多信息），
   正文要宽松（17px / 行高 1.9，连续长文更耐读）。共用一套字号会互相牵制。
3. **可替换。** 将来换渲染器只需重写 `content.css`，外壳完全不受影响。

**唯一一处刻意的「同字号不同行高」：**

| 语境     | 行高                        | 实际值（17px） | 谁在用                      |
| -------- | --------------------------- | -------------- | --------------------------- |
| 外壳     | `--leading-relaxed` = 1.75  | 29.75px        | `body` 默认，导航/卡片/页脚 |
| 文章正文 | `--leading-loose` = **1.9** | 32.30px        | `.prose` 内段落             |

中文没有词间空格，长文行距不足时眼睛在换行处容易串行，所以正文单独放宽。
这是**唯一**允许同一字号两个行高的地方，其他任何地方都要保持一个值。

实测：`content.css` 里有 67 处 `.prose`，**没有任何一条规则能影响
`.prose` 之外的元素**。

### 十四个样式文件的职责

顺序在 `styles/index.css` 里，后面的能覆盖前面的。

| 文件                   | 管什么                                                             | 什么时候进这里改             |
| ---------------------- | ------------------------------------------------------------------ | ---------------------------- |
| `tokens.css`           | 全部设计变量（含 z 轴阶梯、浮层色、动效时长曲线、安全区）          | 换色、换圆角、换字号、换间距 |
| `base.css`             | 重置、body、a、图标尺寸、自绘滚动条、焦点环、跳转链接              | 调基础排版、改滚动条         |
| `layout.css`           | 容器、两栏/三栏网格、粘性侧栏、断点                                | 改整体骨架、侧栏宽度         |
| `components.css`       | 页头、页脚、导航、搜索入口、按钮、卡片、标签、徽章、空状态         | 改页头页脚、按钮样式         |
| `content.css`          | **正文专属**：标题、段落、列表、引用、表格、代码块、代码分组、图片 | 改文章正文观感               |
| `posts.css`            | 时间线、文章卡片、文章头尾、目录、分页、上下篇、进度条、404        | 改列表和文章页               |
| `widgets.css`          | 资料卡、自定义卡片、标签云、标签分组、其他标签                     | 改侧栏卡片                   |
| `mobile.css`           | 页头隐藏、导航抽屉、悬浮胶囊、目录浮层、手机断点布局               | 改移动端交互                 |
| `search.css`           | 全站搜索面板                                                       | 改搜索面板                   |
| `lightbox.css`         | 图片查看器（满屏浮层，与搜索同一类）                               | 改查看器                     |
| `link-preview.css`     | 链接悬浮预览卡（小浮层，Teleport 到 body）                         | 改悬浮卡                     |
| `route-transition.css` | 页面切换与主题切换的 `::view-transition-*`                         | 改整页过渡                   |
| `print.css`            | 打印样式                                                           | 调打印                       |
| `index.css`            | `@import` 汇总，别放规则                                           | 加新样式文件时登记           |

> **`content.css` 必须排在 `posts.css` 之前。**
> `posts.css` 里有一条 `.prose h2` 的移动端缩小规则，需要压过
> `content.css` 的正文默认值。调整 `@import` 顺序时注意这条依赖。
>
> **`lightbox.css` 要排在 `mobile.css` 之后**：查看器里有几条移动端规则
> （藏左右按钮、藏文件名）需要压过 `mobile.css` 的通用规则。
>
> **`route-transition.css` 放在 `lightbox.css` 之后、`print.css` 之前**：
> 它是全局动画层，只处理伪元素，与任何组件规则都不冲突，
> 但必须早于 `print.css`（打印时整页过渡毫无意义）。

### 响应式断点

| 断点                | 行为                                                       |
| ------------------- | ---------------------------------------------------------- |
| `max-width: 1120px` | 三栏 → 单栏（右栏目录移到正文下方）                        |
| `max-width: 960px`  | 两栏 → 单栏（侧栏移到正文下方）                            |
| `max-width: 720px`  | **切到移动端模式**：页头换单行、侧栏整体隐藏、胶囊接管导航 |
| `max-width: 640px`  | 上下篇变单列                                               |

720px 是**模式切换**而不是「缩小一号」：跨过它之后，导航从页头的横向列表
换成「汉堡抽屉 + 悬浮胶囊」，侧栏卡片离开文档流（精简资料条移进抽屉）。
所以改这个断点要同时看 `--header-height` 与 `mobile.css` 的整块规则——
它们是一体的，不是各自独立的媒体查询。

加响应式规则时改对应文件末尾的 `@media` 块，别新建文件。

### 加一个样式文件

1. 在 `styles/` 下建 `xxx.css`
2. 在 `styles/index.css` 里按顺序 `@import './xxx.css';`
3. 位置决定优先级——放 `print.css` 前面

### 动效层（要动动画时先读这一节）

动效是**一套横跨多文件的能力**，不是某个样式文件里的一堆 `@keyframes`。
规范在 `DESIGN.md` 第七节，这里是实现索引。

**三个必须知道的机制：**

| 机制         | 文件                                         | 作用                                                              |
| ------------ | -------------------------------------------- | ----------------------------------------------------------------- |
| 进出状态机   | `composables/usePresence.ts`                 | `v-if` 不能挂在业务开关上（否则退出动画没地方播），改挂 `present` |
| 导航前关浮层 | `support/overlay.ts` 的 `closeAllOverlays()` | 修过"点搜索结果后面板不关、滚不动"的 bug                          |
| 页面过渡     | `support/route-transition.ts`                | 接在 VitePress router 钩子上，所有导航方式统一                    |

**给新浮层加进出动画的步骤：**

1. 用 `usePresence(open)` 拿到 `present` / `exiting`；
2. 模板改成 `v-if="present"` + `:class="{ 'is-exiting': exiting }"`；
3. 进入动画挂在基础选择器上，退出动画挂在 `.is-exiting` 后裔上；
4. 滚动锁与焦点归还**移到 `watch(present)`**，不要留在 `watch(open)`；
5. 在 `support/overlay.ts` 里 `registerOverlayCloser()` 登记（客户端 only）；
6. `@media (prefers-reduced-motion: reduce)` 里把**进入与退出两条都**列上 `animation: none`。

**⚠️ 两条最容易踩的坑：**

- `EXIT_MS`（`usePresence.ts`）必须等于 `--duration-exit`（`tokens.css`）。
  CSS 决定动画多长，TS 决定 DOM 留多久，`tests/presence.test.ts` 里有断言钉住。
- **不要给元素加 `view-transition-name`**。名字必须全局唯一，本站列表页会有
  多个 `.page-title`，重名会让浏览器**静默放弃整次过渡**（"过渡时有时无"）。

---

## 五、改组件

### 页面组件怎么选

`Layout.vue` 是一张查表：

```ts
frontmatter.layout === 'home'   → HomePage.vue    首页
                    'posts'     → PostsPage.vue   文章列表 + 分页
                    'tags'      → TagsPage.vue    标签云 + 分组
                    'tag'       → TagPage.vue     单标签（动态路由）
                    其他/不写    → DocPage.vue     文章与普通页共用
```

**加一个新页面类型**：

1. 在 `components/pages/` 新建 `XxxPage.vue`
2. 在 `Layout.vue` 的 `switch` 里加一个 `case`
3. 在 Markdown 的 frontmatter 写 `layout: xxx`

不需要碰路由配置——VitePress 按文件路径自动生成路由。

### 页面组件的标准结构

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useData } from 'vitepress'

import { useI18n } from '../../i18n'
import TwoColumn from '../layout/TwoColumn.vue'

// ① 取数据
const { page, frontmatter } = useData()
const { locale, m } = useI18n()

// ② 算派生值
const heading = computed(() => page.value.title)
</script>

<template>
  <TwoColumn>
    <header class="page-header">
      <h1 class="page-title">{{ heading }}</h1>
    </header>

    <div class="prose">
      <Content />
      <!-- ← Markdown 正文渲染在这里 -->
    </div>
  </TwoColumn>
</template>
```

**几个约定**：

- 布局永远用 `TwoColumn` / `ThreeColumn`，不要自己写 `grid`
- 页面大标题用 `page.title`，**不要用 `useData().title`**（后者带站点名后缀，适合 `<title>` 标签）
- 文案用 `m.xxx`，不要写死中文（否则英文站会串中文）
- 链接用 `href()` 包装（处理部署子路径）

### 三个布局外壳

| 组件          | 结构                                                           | 用在哪                  |
| ------------- | -------------------------------------------------------------- | ----------------------- |
| `PageShell`   | 跳转链接 + 页头 + `<main>` + 页脚 + 悬浮胶囊 + 搜索 + 视口补偿 | `Layout.vue` 包在最外层 |
| `TwoColumn`   | 左侧栏 + 主内容                                                | 首页、列表、普通页      |
| `ThreeColumn` | 左侧栏 + 主内容 + 右侧栏（具名插槽 `#aside`）                  | 文章页、标签页          |

搜索状态由 `PageShell` 单一持有：桌面入口在 `SiteHeader`、移动入口在
`MobileDock`，两边都通过 `@search` 事件把开关请求发上来，面板只有一份。

`ThreeColumn` 的用法：

```vue
<ThreeColumn>
  <!-- 默认插槽：主内容 -->
  <article>...</article>

  <!-- 具名插槽：右栏 -->
  <template #aside>
    <OutlineCard v-if="hasOutline" />
    <StatsCard v-else />
  </template>
</ThreeColumn>
```

### 侧栏卡片：加一张新卡

侧栏是个注册表，三步：

**① 新建组件** `components/aside/MyCard.vue`：

```vue
<script setup lang="ts">
import { useI18n } from '../../i18n'
const { m } = useI18n()
</script>

<template>
  <section class="card">
    <p class="card__title">我的卡片</p>
    <div class="widget__body">内容</div>
  </section>
</template>
```

**② 登记** 在 `AsideWidgets.vue` 的 `REGISTRY` 加一行：

```ts
const REGISTRY = {
  profile: ProfileCard,
  tags: TagsCard,
  links: LinksCard,
  custom: WidgetsCard,
  mycard: MyCard, // ← 新增
} as const
```

**③ 启用** 在 `data/site.ts` 的 `widgets` 里加名字：

```ts
widgets: ['profile', 'mycard', 'tags', 'custom'],
```

**为什么要「登记」**：`WidgetName` 是联合类型，名字拼错会在构建期报错，
而不是悄悄少渲染一张卡。

### 加一张「纯文本卡片」（不写组件）

如果用不上自定义逻辑，直接改 `data/widgets.ts`：

```ts
export const WIDGETS: WidgetDef[] = [
  { title: '关于这个站', content: '支持 **Markdown** 和 HTML' },
  { title: '最近在读', content: '- 《某某书》\n- 《另一本》' },
  { title: '临时停用', content: '...', enabled: false }, // enabled: false 可停用
]
```

前提是 `site.ts` 的 `widgets` 里包含 `'custom'`。

### 加图标

两步：

**① 在 `theme/support/icons.ts` 的 `ICONS` 里加一条**：

```ts
export const ICONS: Record<IconName, IconDef> = {
  // ...
  star: {
    viewBox: '0 0 24 24',
    mode: 'stroke', // 或 'fill'
    body: `<path d="M12 2l3 7 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" />`,
  },
}
```

**② 在 `types.ts` 的 `IconName` 联合类型里加 `| 'star'`**

然后在任何地方用：

```vue
<AppIcon name="star" />
```

尺寸（1em）和颜色（`currentColor`）都由 CSS 控制，不用管。

### 加文案（界面文字）

**① 在 `types.ts` 的 `Messages` 接口加字段**：

```ts
export interface Messages {
  // ...
  myNewLabel: string
}
```

**② 在 `theme/i18n/zh-cn.ts` 和 `en.ts` 各补一条**：

```ts
export const zhCN: Messages = {
  myNewLabel: '我的新文案', // 缺了会 TS 报错
}

export const en: Messages = {
  myNewLabel: 'My new label',
}
```

**③ 组件里用**：

```vue
<script setup lang="ts">
const { m } = useI18n()
</script>

<template>
  <p>{{ m.myNewLabel }}</p>
</template>
```

带变量的文案用 `format`：

```ts
// 文案表里：termCount: '共 {count} 篇文章'
{
  {
    format(m.termCount, { count: 3 })
  }
}
```

**好处**：`Messages` 接口强制中英对齐，漏翻译会在 `pnpm typecheck` 时报错。

### 加组合式函数

`theme/composables/` 下按功能拆。示例——「热门文章」：

```ts
// theme/composables/usePopularPosts.ts
import { computed } from 'vue'

import { usePosts } from './usePosts'

export function usePopularPosts(limit = 5) {
  const { posts } = usePosts()

  // 按字数排（示例逻辑）
  const popular = computed(() => [...posts.value].sort((a, b) => b.wordCount - a.wordCount).slice(0, limit))

  return { popular }
}
```

**约定**：

- 文件名与函数名一致，`use` 开头
- 只做数据派生，不碰 DOM（碰 DOM 的放 `support/`）
- 自动跟随语言——`usePosts` 已经按 `locale` 过滤了

### 现有组合式函数

| 文件                 | 提供什么                                       |
| -------------------- | ---------------------------------------------- |
| `usePosts`           | 当前语言的全部文章（已排序、已剔草稿）         |
| `useTaxonomy`        | 当前语言的标签汇总（含每个标签的文章）         |
| `useCurrentPost`     | 当前页面匹配到的文章（判断「是不是文章页」）   |
| `useAdjacentPosts`   | 上一篇 / 下一篇                                |
| `useLocaleSwitch`    | 语言切换的选项与目标地址（文章先按配对键直达） |
| `useActiveAnchor`    | 目录高亮（当前滚动到哪一节）                   |
| `useReadingProgress` | 阅读进度 0–1                                   |
| `useDockState`       | 移动端「阅读态」：页头隐藏 / 胶囊收成圆        |
| `useScrollBar`       | 自绘滚动条：拇指长度、位置与拖拽               |
| `useImageViewer`     | 图片查看器：画廊、翻页、缩放、平移、状态       |
| `useLinkPreview`     | 链接悬浮预览：匹配 provider、取数、缓存、显隐  |

**`useLocaleSwitch` 的目标地址按四级推导**（详见 `support/translation.ts` 注释）：

1. **文章配对**：当前页是文章时，按配对键直达另一语言的同一篇。
   配对键来自 frontmatter 的 `translationKey`，或由 `posts/YYYY/MM/DD/NN/`
   目录编号推导——两语言 slug 本地化后路径不同名，纯路径匹配必然失配，
   这是「中文文章目录改中文名后语言切换退回列表页」那个 bug 的修复；
2. 完全同名的页面（about 等非文章页）；
3. 同栏目索引（`/en/posts/`）；
4. 语言首页。

数据源是 `posts.data.ts`（构建期已为每篇文章算好 `translationKey`）
与 `pages.data.ts`，不在运行时猜路径。`config.ts` 的 hreflang 互指
（`alternateLinks`）复用同一个配对索引，保证 SEO 互指与切换行为一致。

**`useDockState` 是模块级单例，可以多处调用**
（`SiteHeader` 与 `MobileDock` 就各调了一次），不会重复绑定事件。
不要改成「每个组件各持一份 ref」——那样两个组件会算出不同结论，
表现为「页头藏了但胶囊没缩」这类诡异 bug。

`useScrollBar` 不是单例（只有 `ScrollBar` 一个消费者），但它**复用
`useScrollEffect`** 这个全站唯一的滚动订阅。要加新的「滚动联动」效果，
照它的样子接进去，不要自己 `addEventListener('scroll')`。

**`useImageViewer` 也是模块级单例**，理由同 `useDockState`：打开入口是正文里
构建期生成的 `<a data-lightbox>`（不是 Vue 组件），只能靠 `PageShell` 里的
**一次事件委托**接；而查看器组件本身在 `PageShell` 里挂一份。两边必须看到
同一份状态，否则会出现「点了图但查看器不弹」。

它刻意**零 props / 零 emits**：正文与查看器之间没有任何 prop 链，
将来正文换成富文本组件也不用改查看器。

### 加数据字段（进阶）

以「给文章加 `cover` 封面图字段」为例，**一共改 3 处**：

**① `types.ts` 的 `PostSummary` 加字段**：

```ts
export interface PostSummary {
  // ...
  cover: string
}
```

**② `support/content.ts` 的 `toPostSummary` 里赋值**：

```ts
return {
  // ...
  cover: typeof doc.data.cover === 'string' ? doc.data.cover : '',
}
```

**③ 组件里用**：

```vue
<img v-if="post.cover" :src="post.cover" />
```

**不要**在组件里直接读 `frontmatter` 拿文章信息——那样每个组件都要自己解析，
且拿不到列表页的数据。所有文章级信息都应该走 `PostSummary`。

---

## 六、标签与路由

### 标签页是怎么来的

`docs/zh-cn/tags/[tag]/index.md` 是模板，`index.paths.ts`（构建期跑）生成具体路由：

```ts
export default {
  watch: ['../../../**/*.md'], // 文章变了就重新生成

  paths() {
    const slugs = new Set<string>()
    for (const post of readPosts('zh-cn')) {
      for (const tag of post.tags) slugs.add(tag.slug)
    }
    return [...slugs].sort().map((tag) => ({ params: { tag } }))
  },
}
```

所以：**文章加了新标签 → 自动出现标签页**，不需要写文件。

同理，`docs/zh-cn/posts/page/[page]/index.paths.ts` 生成分页路由（第 2 页起）。

> 注意：VitePress 1.6.4 **没有** `defineRoutes` 辅助函数（2.x 才有），
> 所以这里是裸 `export default`，别写成 `defineRoutes({...})`。

### 标签 URL 转英文

默认标签名即 URL（`/zh-cn/tags/随笔/`）。想变英文，改 `data/taxonomy.ts`：

```ts
export const TAG_SLUGS: Record<string, string> = {
  随笔: 'essay', // /zh-cn/tags/随笔/ → /zh-cn/tags/essay/
  工具: 'tools',
}

export const TAG_LABELS: Record<string, string> = {
  随笔: '随笔', // 展示名（可用来统一大小写）
}
```

**改 slug = 换地址 = 旧链接 404**。要保留旧链接，在 `public/` 放跳转页。

### 分页

第 1 页是 `/zh-cn/posts/`，第 2 页起是 `/zh-cn/posts/page/N/`。

- 每页几篇：`site.ts` 的 `postsPerPage`
- 分页计算：`theme/support/pagination.ts`（纯函数）
- 页码越界会自动夹到 `[1, totalPages]`，不会白屏

### 命令行脚本体系

写文章时用得最多的是 `pnpm new` 与 `pnpm posts`，它们**不是**各自独立的脚本，
而是共享同一套内核。

**为什么单入口 + 共享内核**

`package.json` 里所有自有命令都指向 `tsx scripts/run.ts <命令>`：

```text
pnpm new    →  tsx scripts/run.ts new
pnpm posts  →  tsx scripts/run.ts posts
pnpm check  →  tsx scripts/run.ts check
```

`run.ts` 按命令名动态 `import` 对应模块，并统一负责参数透传与错误出口
（业务代码只管 `throw new Error('人话')`，由它打印成一行 `✗ 原因` 并置非零退出码）。

这样做的好处很具体：8 个命令如果各有各的入口，就有 8 份 `try/catch`、
8 份颜色开关判断、8 份「仓库根在哪」。共享内核后这些只有一份。

**为什么命令脚本要复用 `.vitepress` 里的定义**

这是本次重构的核心判断：脚本与站点**一定**有重合部分，重合的就是「事实来源」。

| 事实                  | 唯一来源                         | 谁在用                      |
| --------------------- | -------------------------------- | --------------------------- |
| 有哪些语言            | `.vitepress/data/site.ts`        | 构建期、主题、**命令行**    |
| 站点时区              | `.vitepress/data/site.ts`        | RSS、日期格式化、**命令行** |
| 文章 frontmatter 字段 | `.vitepress/data/frontmatter.ts` | 内容管线、**命令行**        |
| 什么算一篇文章        | `.vitepress/support/content.ts`  | 列表/标签/RSS、**命令行**   |

因此 `scripts/lib/` **不复制**这些定义，只做再导出。加一门语言或加一个
frontmatter 字段时，改一处，构建与命令一起跟上。

**`pnpm list` 为什么不存在**

`list` 是 pnpm 的内置命令，会在执行脚本之前先解析参数并直接失败：

```text
$ pnpm list 20261024 -l=zh-cn
error: unexpected argument '-l' found
```

脚本根本不会启动。所以对外统一用 `pnpm posts`；`list` 只作为
`pnpm run list`（显式走 run）的别名保留，注意 `pnpm run list …` 可以，
裸 `pnpm list …` 不行。

同理 `pnpm help` 也是内置命令，所以查看总帮助用 **`pnpm guide`**。

**`pnpm clean --help` 会被 pnpm 截获**

`clean` 这个**命令名**可以正常覆盖内置的同名命令（`package.json` 里定义了
`clean` 脚本时，`pnpm clean` 执行的是我们的脚本）。但 `--help` / `-h` 是
pnpm 的**全局**标志，它在决定「跑哪个命令」之前就把 `--help` 消费掉了：

```text
$ pnpm clean --help
Safely remove `node_modules` directories ...   ← pnpm 内置 clean 的帮助
```

要看本项目的 clean 帮助，直接调脚本：

```powershell
npx tsx scripts/run.ts clean --help
```

这是 pnpm 参数解析顺序导致的，改不了。**其余命令没有这个问题**
（`pnpm new --help`、`pnpm posts --help` 等都正常），因为它们不是内置命令名。

**`pnpm new` 的日期与序号**

```text
docs/<lang>/posts/YYYY/MM/DD/NN/<slug>/index.md
                   ↑ 北京时间的今天   ↑ 当天的第几篇
```

- 日期取**站点时区**（`Asia/Shanghai`），不是运行机器的本地时区，
  否则 CI（UTC）与本地可能差一天；
- 序号扫**目录名**得出（不是扫 frontmatter），`01`、`02`…自动递增，
  中间有空号时优先补空号；满 `99` 直接报错而不是变成三位；
- frontmatter 的**全部字段**一次写全（`title` / `date` / `tags` /
  `description` / `draft` / `outline`），字段表来自 `data/frontmatter.ts`；
- `date` 写成带显式偏移的完整 ISO 串（`2026-10-24T22:49:28+08:00`），
  不用裸日期——裸日期会被不同构建机按不同时区解读。

只想看看会生成什么、不落盘：

```powershell
pnpm new -t="标题" --dry-run
```

**`pnpm check` / `pnpm fix` 的边界**

`check` 只报告、不改文件，分两级：`error`（会坏内容/构建）与 `warn`（不合规范）。
有 `error` 时退出码为 1，可直接接进 CI；只有 `warn` 时为 0。

`fix` 只做**安全**的修改：重排字段顺序、补齐可选字段、把裸日期补成带时区的格式、
规范化标签。它**不改**标题、正文、目录名，也不删废弃字段——那些改错了没有撤销按钮。

`fix` 的行为有两条硬约束，都是踩过坑之后加的：

1. 判断「日期是否已合规」必须读**文件里的原始字面量**。
   `gray-matter` 会把 `date` 解析成 `Date` 对象，解析后无法区分
   `2026-10-19T04:09:28+08:00` 与 `2026-10-19`；早期按解析值判断，
   导致 `fix` 把每个文件都当成需要修并全部重写。
2. 写回时必须**跟随正文的换行风格**。本机 `core.autocrlf=true`、
   仓库又没有 `.gitattributes`，所以工作区里的 Markdown 是 CRLF、
   仓库里存的是 LF；固定用 LF 拼接会把整篇正文标记成改动。

**加一个动态路由**

比如「按年份归档」`/zh-cn/archive/2026/`：

**① 建模板** `docs/zh-cn/archive/[year]/index.md`：

```markdown
---
layout: archive
title: 归档
---
```

**② 建生成器** `docs/zh-cn/archive/[year]/index.paths.ts`：

```ts
import { readPosts } from '../../../../.vitepress/support/content'

export default {
  watch: ['../../../**/*.md'],
  paths() {
    const years = new Set(readPosts('zh-cn').map((post) => post.year))
    return [...years].map((year) => ({ params: { year } }))
  },
}
```

**③ 加页面组件** `components/pages/ArchivePage.vue`，在 `Layout.vue` 登记 `layout: archive`

**④ 读参数**：

```ts
const { params } = useData()
const year = computed(() => String(params.value?.year ?? ''))
const posts = computed(() => allPosts.filter((p) => p.year === year.value))
```

**注意**：`index.paths.ts` 里引用 `.vitepress` 下的代码要用相对路径，
因为它在 `docs/<locale>/` 内容目录里、不在 `.vitepress` 下。
**`.vitepress` 提到仓库根之后，所有这类相对路径的层级都要比原来多一层**
（例如 `docs/zh-cn/tags/[tag]/` 下是 `../../../../.vitepress/...`）。
新增动态路由时数一下目录深度，别照抄旧文档。

---

## 七、加功能：任务清单

### 「给文章加一个字段」

1. `types.ts` → `PostSummary` 加字段
2. `support/content.ts` → `toPostSummary` 里从 `doc.data` 取值
3. 组件里用 `post.xxx`

### 「加一个页面类型」

1. `components/pages/XxxPage.vue`
2. `Layout.vue` 的 `switch` 加 `case`
3. Markdown 里写 `layout: xxx`

### 「加一段界面文字」

1. `types.ts` → `Messages` 加字段
2. `theme/i18n/zh-cn.ts` + `en.ts` 各补一条
3. 组件里 `m.xxx`

### 「加一个图标」

1. `theme/support/icons.ts` → `ICONS` 加条目
2. `types.ts` → `IconName` 加字面量
3. `<AppIcon name="xxx" />`

### 「加一张侧栏卡」

1. `components/aside/XxxCard.vue`
2. `AsideWidgets.vue` → `REGISTRY` 登记
3. `site.ts` → `widgets` 数组加名字

### 「加一种颜色 / 改主题色」

1. `styles/tokens.css` → 改原始层色阶，或改语义层 `--accent`

### 「加一段 CSS」

1. 判断属于哪个职责 → 对应 `styles/*.css` 末尾
2. 只用 `var(--xxx)`，不写死数值

### 「加一个 npm 脚本」

**先判断它属于哪一类**，这决定了脚本写在哪：

| 类型                  | 做法                                            | 例子                                |
| --------------------- | ----------------------------------------------- | ----------------------------------- |
| 第三方 CLI 的直接转发 | 直接写在 `package.json`，不要包一层             | `dev`、`build`、`typecheck`、`lint` |
| 有自己的逻辑          | 在 `scripts/` 下加一个命令文件，走统一入口      | `new`、`posts`、`check`             |
| 只是给已有命令起别名  | 在 `package.json` 里指向同一个 `scripts/run.ts` | `list` → `posts`                    |

第三方 CLI 不该包脚本：多一层转发不会带来任何共享逻辑，只多一个要维护的文件。

有逻辑的命令按第三步：

```text
① scripts/xxx.ts 里 export default function main(argv: string[]): void
② scripts/run.ts 的 COMMANDS 里加一行：xxx: 'xxx.ts'
③ package.json 里加：  "xxx": "tsx scripts/run.ts xxx"
④ 加进 scripts/run.ts 的 printHelp()，否则 pnpm help 里看不到它
```

命令之间**不要各自重写**下面这些，它们是共享内核：

| 需求               | 从哪来                           |
| ------------------ | -------------------------------- |
| 语言校验           | `scripts/lib/site.ts`            |
| 北京时间的日期换算 | `scripts/lib/dates.ts`           |
| frontmatter 字段表 | `.vitepress/data/frontmatter.ts` |
| frontmatter 读写   | `scripts/lib/frontmatter.ts`     |
| 参数解析           | `scripts/lib/args.ts`            |
| 颜色 / 对齐 / 表格 | `scripts/lib/ui.ts`              |

```json
{
  "scripts": {
    "verify": "pnpm typecheck && pnpm format:check"
  }
}
```

---

## 八、删功能：反向操作

按上面的清单反着做，**每步都要跑 `pnpm typecheck`**，TS 会告诉你漏了什么。

### 删一个页面

```text
① 删 docs/xxx/index.md
② 删 components/pages/XxxPage.vue
③ 删 Layout.vue 里对应的 case 和 import
④ 删 site.ts 里 NAV 的对应项（两种语言都要删）
```

### 删一张侧栏卡

```text
① site.ts → widgets 数组去掉名字（立刻看不见，但组件还在）
② 想彻底删：AsideWidgets.vue 删 REGISTRY 条目 + 删组件文件
```

### 删一个图标

```text
① types.ts → IconName 去掉字面量（TS 会指出还有谁在用）
② icons.ts → ICONS 删条目
③ 修掉还在用它的地方
```

### 删一段文案

```text
① types.ts → Messages 去掉字段
② zh-cn.ts + en.ts 删条目
③ 修掉还在用 m.xxx 的组件
```

### 删整块功能（以 RSS 为例）

```text
① config.ts → 删 buildEnd
② 删 support/rss.ts
③ 删 ProfileCard 里的 RSS 链接（profile.ts）
④ 删 SiteFooter 里的 RSS 入口
⑤ 删 config.ts transformHead 里的 alternate 标签
```

### 删一种语言

```text
① 删 docs/en/ 整个目录
② config.ts → locales 删 en
③ data/site.ts → LOCALES 删 en、NAV 删 en
④ types.ts → LocaleCode 改成只有 'zh-cn'（TS 会指出所有要改的地方）
⑤ theme/i18n/ → 删 en.ts，MESSAGES 删对应项
⑥ public/index.html → SUPPORTED 数组删掉 'en'
⑦ 组件里的语言下拉会自动只剩一项（LocaleSwitch 的逻辑会处理）
```

`LocaleCode` 这个联合类型是这套设计的关键——**改它，编译器会带你走完全部改动点**。

---

## 九、检查、测试与格式化

### 命令

```powershell
pnpm typecheck     # TS + Vue 类型检查（0 错误才算过）
pnpm lint          # oxlint：未使用变量、可疑写法、性能提示
pnpm test          # vitest：纯函数单测
pnpm test:watch    # 单测 watch 模式
pnpm format        # 格式化：docs + .vitepress + scripts + 根目录几份 md
pnpm format:check  # 只检查不写入
pnpm build         # 构建（也会暴露类型问题）
```

改完代码的标准流程：`format` → `lint` → `typecheck` → `test` → `build`。

> 注意 `format` 现在显式带上了 `.vitepress` 与 `scripts`——它们已经不在 `docs/` 里了，
> 只写 `docs` 会漏掉主题代码与命令行脚本。

### 单测覆盖什么

`tests/` 下只测**纯函数**（不依赖 VitePress 运行时、不读磁盘）：

| 文件                        | 覆盖                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `urls.test.ts`              | 相对路径 → URL、中文编码、与 `decodePath` 互逆                                                   |
| `paths.test.ts`             | 语言前缀换算、`asLocale`、`postListPath`、`LOCALES` 一致性                                       |
| `translation.test.ts`       | 跨语言配对键推导（显式 > 目录编号）、配对索引与回退                                              |
| `pagination.test.ts`        | 分页边界（空列表、越界、非法 perPage）                                                           |
| `format.test.ts`            | 日期格式化、RFC 822、字数统计、纯文本化                                                          |
| `dev-redirect.test.ts`      | `Accept-Language` 解析                                                                           |
| `markdown-plugins.test.ts`  | `==高亮==` 与任务列表的渲染、嵌套、**不误伤比较运算**（含双比较）                                |
| `markdown-pipeline.test.ts` | 两条渲染路径（页面正文 / 简介卡片）对同一段 Markdown 产出一致                                    |
| `directives.test.ts`        | 块级指令：参数解析、四个指令、嵌套、代码块内的 `:::`、错误文案、`shared/github`                  |
| `offline-build.test.ts`     | **构建期零网络**：把 `fetch` 换掉再真跑一次 `pnpm build`（守核心契约）                           |
| `shared-github.test.ts`     | URL 解析与仓库名归一化、数字缩写、相对天数                                                       |
| `media-planner.test.ts`     | 格式裁决、档位计算、命名规则、`sizes` 常量、base 拼接、LQIP 文件名                               |
| `media-probe.test.ts`       | 图片头部尺寸探测（PNG/JPEG/WebP/GIF/SVG/AVIF 的真实文件头）                                      |
| `media-render.test.ts`      | `<figure>` 提升边界、alt/图注/宽高、`data-plain` 开关、`data-lqip` 内联、**与 attrs 的顺序契约** |
| `link-preview.test.ts`      | 链接预览纯函数：GitHub/bilibili URL 解析、缓存键归一化、TTL、数字缩写、域名兜底卡                |
| `anchor-scroll.test.ts`     | 锚点留白（读 `scroll-padding-top`）、滚动扣减、**滚动锁排队**（iOS 真机 bug）                    |
| `presence.test.ts`          | 浮层进出时机、退出途中重开、`EXIT_MS` 与 CSS 契约                                                |
| `overlay-registry.test.ts`  | 浮层强制关闭登记表：注册、注销、幂等                                                             |
| `scripts.test.ts`           | 命令行内核：北京时间换算、序号分配、frontmatter 序列化                                           |

`scripts.test.ts` 覆盖的是「建错会静默写坏内容」的那批函数：
`nextSequence`（序号会不会撞号）、`stringifyFrontmatter`（会不会写坏 YAML）、
`isoDateInZone`（会不会差一天）、`parseArgs`（`-l=zh-cn` 这类写法）。

`media-probe.test.ts` 覆盖的是整条管线里**唯一手工解析二进制**的地方：
它一旦读错，产物会出现「渲染尺寸与实际像素不符」——图片被拉伸变形，
而构建期完全不会报错。所以每个格式都用**真实最小文件头**验证。

`media-render.test.ts` 用 `tests/fixtures/tiny.png`（400×225）当真实源文件，
覆盖「哪些图会被提升成 `<figure>`」的边界：行内图、带链接的图、外链、
多图段落都不提升。

`presence.test.ts` 与 `overlay-registry.test.ts` 保护的是**动效层的两条契约**：
`v-if` 挂 `present` 之后，DOM 的摘除时机由 `EXIT_MS` 决定（太早摘退出动画播不完，
太晚摘元素会拦截点击）；浮层登记表则保证导航前一定关干净
（不关的话会出现"遮罩盖住新页面、滚不动"的实测 bug）。
`presence.test.ts` 里有一条断言把 `EXIT_MS` 与 `--duration-exit` 钉在一起。

`anchor-scroll.test.ts` 的后半组守的是**手机上目录跳转失效**那个真机 bug：
滚动锁持有期间（iOS 下 `body` 被 `position: fixed`）发起的跳转必须**排队**，
等锁归零后再滚。契约是"锁着时一次都不许滚，解锁后必须滚到正确位置"。
⚠️ 这个 bug 用普通移动 UA 复现不出来，必须伪装 iPhone UA；
手动验证见 DESIGN.md 7.5 末尾。

锚点滚动的**执行者唯一性**也有一条架构契约：目录链接（`.toc__list` /
`.m-toc__list`）与正文 `header-anchor` 都带 `vp-raw` —— 这是 VitePress
点击委托的豁免类，没有它 VitePress 会在自己的 rAF 里先做一次无法取消的
`window.scrollTo(0, y)`，与锁释放后的位置还原叠加，就是手机上
「先抽搐再平滑跳」的来源。目录列表在渲染层打标（OutlineCard /
MobileDock），`header-anchor` 由 `theme/index.ts` 在 `onContentUpdated`
时补打（`markHeaderAnchorsRaw`）。新增目录类 UI 时记得同样打 `vp-raw`。

为了让这些函数能在 Node 里跑，纯逻辑刻意放在
`.vitepress/support/urls.ts`、`.vitepress/support/locale-paths.ts`
与 `.vitepress/support/translation.ts`，
**不 import `vitepress`**；需要 `withBase` 的包装留在 `theme/support/paths.ts`。

图片管线同理：`media/planner.ts` 与 `media/probe.ts` 是纯函数、可直接加载；
`media/registry.ts` 会读磁盘，`media/transcode.ts` 才 import sharp ——
所以单测不需要原生模块也能跑。

脚本侧的纯逻辑同理放在 `scripts/lib/`（`dates.ts` / `frontmatter.ts` / `create.ts` 等），
不 import `vitepress`，因此可以直接被 vitest 加载。

### lint 规则

`.oxlintrc.json` 开启 `correctness`（error）、`suspicious` / `perf`（warn）。
当前 0 warning 0 error；新增代码若引入 `Array#sort()` 这类原地修改，
会被 `unicorn/no-array-sort` 提示改用 `toSorted()`。

### 格式化覆盖什么

`.oxfmtignore` 排除了这些：

```text
node_modules / .pnpm-store / .npm-cache
.vitepress/dist / .vitepress/cache / .vitepress/.temp
public / media  # 原样输出的静态资源
pnpm-lock.yaml
```

**其余全格式化**：`.md`、`.ts`、`.vue`、`.css`、`.json`。

### 两条 Vue 相关规则（踩过坑）

**① 属性只在超长时换行**

`.oxfmtrc.json` 里给 `**/*.vue` 覆盖了 `singleAttributePerLine: false`。
默认的全局设置会让每个属性独占一行，模板会膨胀两三倍。

**② 组件注释不能写在 import 之上**

`oxfmt` 会把所有 `import` 提到 `<script setup>` 最前面，写在 import 之上的注释会
**被留在原地、夹在两条 import 中间**：

```vue
<!-- ❌ 格式化后会被拆开 -->
<script setup lang="ts">
/**
 * 组件说明
 */
import { computed } from 'vue'
import { useI18n } from '../../i18n'
</script>
```

正确位置是 **import 块之后、第一条语句之前**：

```vue
<!-- ✅ 稳定 -->
<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../i18n'

/**
 * 组件说明
 */
const { m } = useI18n()
</script>
```

### 格式化规则

`.oxfmtrc.json` 关键项：

```json
{
  "semi": false, // 无分号
  "singleQuote": true, // 单引号
  "printWidth": 100,
  "tabWidth": 2,
  "sortImports": true, // import 自动排序
  "singleAttributePerLine": true // 但 .vue 覆盖为 false
}
```

Markdown 用 120 字符宽、`proseWrap: preserve`（不重排段落）。

---

## 十、部署

### 自动流程

推送到 `master` → GitHub Actions → 构建 → 发布到 GitHub Pages。

`.github/workflows/deploy.yml` 做了三件事：

1. 算部署路径：仓库名是 `xxx.github.io` 就用根路径，否则用 `/<repo>/`
2. 算站点地址，可用仓库变量 `SITE_URL` 覆盖（绑定自定义域名时用）
3. `pnpm build` 后上传 `.vitepress/dist`

本地不用配任何东西。

### 需要人工确认的

- 仓库 Settings → Pages → Source 必须是 **GitHub Actions**
- 绑定自定义域名时：
  - `public/CNAME` 写域名
  - `data/site.ts` 的 `SITE_URL` 改成同一域名
  - 仓库变量 `SITE_URL` 也改成同一域名

### 改域名要动的地方

```text
① data/site.ts → SITE_URL
② public/CNAME（如用自定义域名）
③ 仓库变量 SITE_URL（可选，覆盖 CI 里的绝对地址）
```

`SITE_URL` 影响：sitemap 的 `<loc>`、RSS 的绝对链接、canonical、OG `og:url`、
`robots.txt` 里的 `Sitemap:`。后两者由构建期生成，无需手工改文件。

### 根路径 `/` 的语言跳转

`public/index.html` 会被原样拷到产物根，作为 `/` 的入口：

- **页面不渲染任何可见内容**：跳转脚本放在 `<head>` 里，在 `<body>` 解析之前就执行
  `location.replace()`，浏览器还没机会绘制就已经跳走。不要把它改回「body 末尾 + 一段提示文字」
  ——那会出现一次很突兀的中转页闪现
- 它**不写死任何域名或 base**，跳转目标是相对路径，靠 `new URL(相对, location)` 解析，
  因此 `/`、`/repo/`、自定义域名三种部署都能正确跳到 `zh-cn/` 或 `en/`
- 页面带 `noindex`，不进 sitemap，也不参与 hreflang 配对
- `<body>` 里只有一个 `<noscript>` 兜底链接，禁用 JavaScript 时才会显示
- dev 阶段由 `.vitepress/support/dev-redirect.ts` 用 `Accept-Language` 做同样的事（302）

---

## 附：设计决策速查

几个「当时为什么这么做」的记录，避免以后推翻重来。

| 决策                                          | 理由                                                                                                                                                  |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 完全自定义主题，不 extends 默认主题           | 默认主题 DOM 与样式高度耦合，还原三栏 + 卡片侧栏要大量覆盖，反而更难维护                                                                              |
| 目录式 URL（`cleanUrls: false`）              | 不依赖服务器把 `/x` 映射到 `/x.html`，任何静态托管都能跑                                                                                              |
| Shiki 单主题 `github-dark-default`            | 原站代码块在明暗两套下都是深色；单主题省掉双主题 CSS 变量切换。用 `-default` 变体是因为旧 `github-dark` 的注释色在 `--bg-code` 上只有 3.96:1，低于 AA |
| 字数在构建期计算                              | 汉字按字、拉丁按词；客户端零成本                                                                                                                      |
| 日期固定 `Asia/Shanghai`                      | 避免构建机时区不同导致跨日                                                                                                                            |
| 数据加载器返回摘要数组，标签/统计在客户端派生 | 文章量小，一份数组足够；避免多份索引不一致                                                                                                            |
| `LocaleCode` 用联合类型                       | 改语言集合时，TS 会指出所有需要适配的位置                                                                                                             |
| 标签页用动态路由 + `paths()`                  | 新增标签无需手写文件，是静态博客最容易腐化的地方                                                                                                      |
| 侧栏用注册表而非约定式                        | 名字拼错在构建期报错，而不是悄悄少渲染                                                                                                                |
| `.vitepress` 放仓库根                         | 配置/主题与内容分离；`srcDir`/`outDir`/`cacheDir` 显式声明即可                                                                                        |
| 中文也带 `/zh-cn/` 前缀                       | 与 `docs/zh-cn/` 一一对应，两种语言完全对称，无隐式映射                                                                                               |
| 根路径只做语言分发                            | 浏览器语言优先、手动选择记忆；比在根目录塞一份重复首页更干净                                                                                          |
| 高亮/任务列表自写插件，不装现成包             | 两个包都无类型、`task-lists` 停更于 2018；自写零依赖，DOM 可控（详见 `support/markdown-plugins.ts` 顶部注释）                                         |
| 占位图放 `public/`                            | 外链（`via.placeholder.com`）在部分网络下加载失败，表现为"图片语法坏了"                                                                               |

---

## 附：移动端设计约定

手机端不是「桌面的缩小版」，是**另一套操作模型**。改这块之前先读这一节，
否则很容易把已经解决的问题重新引入。

### 只有两种状态

| 状态      | 页头 | 悬浮胶囊       | 触发条件                      |
| --------- | ---- | -------------- | ----------------------------- |
| `rest`    | 显示 | 展开成横向胶囊 | 顶部 200px 内 / 向上滚 / 上滑 |
| `reading` | 隐藏 | 收成右下角圆   | 向下累计滚过 24px             |

状态由 `composables/useDockState.ts` 单一维护。**不要**在组件里另起一套
滚动判定——会出现「页头藏了胶囊没缩」这类不一致。

### 五个「看起来能改、其实会踩坑」的点

1. **`env(safe-area-inset-*)` 需要 `viewport-fit=cover`**
   `config.ts` 的 `head` 里显式覆盖了 `viewport` 那条 meta（VitePress 1.6.4 的
   `isMetaViewportOverridden()` 支持覆盖）。删掉它，全站安全区适配会**静默失效**，
   且没有任何报错——只在真机刘海屏上表现为「胶囊被切角」。
   `public/index.html` 里那条必须同步，两边不一致会导致跳转页闪一下错位。

2. **停靠抬升只能用 `--dock-lift` 一个变量，且内部是 `max()` 而不是相加**
   安全区与浏览器工具栏在物理上不会同时遮挡同一块像素。相加会让胶囊在两件事
   都「看起来成立」时被顶到半屏高。这是移动端最容易写错的一行。

3. **胶囊的右边缘由 `transform` 百分比钉死**
   `translateX(calc(50vw - var(--dock-inset) - 100%))` 里的 `100%` 按元素
   **当前**宽度解析，所以右边缘恒等于 `100vw - var(--dock-inset)`，与宽度无关。
   收缩时只改 `width`，不要去插值 `transform` 或改 `right`——那会让右边缘跟着漂。

4. **浮层必须 `Teleport to="body"`**
   祖先 `.site-header` 有 `backdrop-filter`，它会为 `position: fixed` 后代
   **创建包含块**，浮层会被裁成页头那么高。这是 CSS Containment 的规定行为，
   写多少 `height: 100%` 都没用。抽屉、目录、搜索三处都因此 Teleport。

5. **抽屉里不能用下拉菜单**
   面板中部是 `overflow-y: auto`，而 `.locale-switch__menu` 是
   `position: absolute` —— 会被滚动容器直接裁掉，表现为「点了没反应」。
   所以语言在抽屉里用 `LocaleSwitch variant="segmented"` 的分段按钮。

### 手机上隐藏了哪些桌面内容，去哪找

| 桌面位置       | 手机上                                   |
| -------------- | ---------------------------------------- |
| 页头横向导航   | 汉堡 → 抽屉                              |
| 左栏资料卡     | 抽屉底部精简资料条（头像 + 名字 + 图标） |
| 左栏标签卡     | 抽屉的「标签」导航项                     |
| 右栏目录卡     | 胶囊的「本页目录」（唯一入口）           |
| 搜索（快捷键） | 胶囊的「搜索」（桌面另有可见入口）       |

720px 以下 `.layout__aside { display: none }` 让侧栏彻底离开文档流，
正文与页脚之间不再有任何卡片——这是「给用户最大阅读空间」的具体手段。

### z 轴阶梯

只用 `tokens.css` 里的命名令牌，**禁止**就地写 `calc(var(--z-header) + N)`。

```text
正文 0 < 滚动条 90 < 页头 100 < 进度条 101 < 胶囊 102 < 抽屉/目录 120 < 搜索 140 < 跳过链接 150
```

进度条必须在页头之上（否则 2px 被页头的毛玻璃背景吃掉），但必须在所有模态之下。

滚动条是**唯一排在页头之下**的浮动元素。它要盖住正文（否则滚动时被内容遮住），
又不能盖住页头（页头是常驻导航，滚动条从它的下沿才开始画）。

### 阅读进度条：属于页头，但用 fixed 定位

这是一个**容易改错**的地方，踩过两次坑，两种错法都记在这里。

**正确结构：** 进度条是 `<header class="site-header">` 的**子元素**
（`SiteHeader.vue`），定位用 `position: fixed`，`top: calc(var(--header-height) + 1px)`。

`.site-header` 有 `backdrop-filter` 和移动端 `transform`，两者都会为
`position: fixed` 后代**创建包含块**。所以进度条的参照是**页头自己**。
这恰好让它自动跟随页头，一个 `top` 值覆盖所有状态：

| 状态            | 页头位置 | 进度条（`top` = 页头高 + 1px） | 视口位置              |
| --------------- | -------- | ------------------------------ | --------------------- |
| 桌面 / 移动静止 | 0        | 57px（相对页头）               | **57px = 页头下沿** ✓ |
| 移动阅读态      | -57px    | 57px（相对页头）               | **0 = 屏幕顶端** ✓    |

桌面端页头永不隐藏，所以进度条永远贴在它下沿；移动端页头滑走，
进度条就跟到屏幕顶端——**桌面和移动的逻辑是同一套，没有分支**。

#### 两种错误改法（都别再试）

1. **把它做成页头的兄弟元素（独立 fixed）。**
   表面上看也行，但要额外加 `top: 0` 的覆盖规则并靠 `is-hidden` 类去判断状态。
   而 `is-hidden` **在桌面端也会被加上**（`SiteHeader.vue` 无条件绑定），
   把页头位移成 `-100%` 的 CSS 却只在移动端媒体查询里 ——
   于是桌面端**页头不动、进度条却被顶到 `top: 0`**，穿过整个页头。
   实测 `gap = -65px`，这就是「进度条和页头不是一起的」这个 bug 的成因。

2. **在 `@media (mobile)` 里加 `.site-header.is-hidden .reading-progress { top: 0 }`。**
   阅读态下包含块**已经是页头**，再设 `top: 0` 等于把进度条推到
   「页头顶边」= 视口 `-57px`，直接飞出屏幕。**不需要任何状态覆盖规则。**

### 滚动条：自绘，但只有页面级

页面级滚动条是自绘的（`components/common/ScrollBar.vue`），
原生条被隐藏（`base.css`）。**完整规范见 [DESIGN.md](./DESIGN.md) 第十一节**，
这里只记改代码时的几件事。

**自动隐藏的三个坑（都踩过，别再踩）。**

1. `lastActivity` 的初值必须是 `-Infinity`。写 `0` 会因为
   `performance.now()` 是「页面加载至今」而被判成「刚活动过」，
   结果页面一加载滚动条就闪一下。
2. `pointermove` 里要跳过 `pointerType === 'touch'`。触屏没有 hover，
   手指抬起**不会**再来 pointerleave，`pointerInside` 会永久停在 true，
   滚动条就再也隐藏不掉了。
3. 指针进出揭示带时**只重算、不刷新活动时间戳**。否则鼠标扫过右边缘
   会把空闲计时重置 1.2 秒，离开后留下一条幽灵条。

**为什么不能挂进 `<header>`。** 层级上它要在页头之下，看起来很自然想
「挂进去」，但页头的 `backdrop-filter` 会为 `position: fixed` 后代创建
包含块，把滚动条关进页头的层叠上下文 —— 那样它的 `z-index` 只跟页头的
子元素比，压不住正文了。所以它和页头**平级**，都挂在 `PageShell`。

**长度下限与轨道上沿都靠测量，不写死令牌。** 轨道上沿取页头实测下沿
（`getBoundingClientRect().bottom`），长度下限取页头实测高度。
不要改成 `--header-height`：那个变量是布局契约，历史上与实际高度
漂移过一次（见上一节）；而且阅读态下页头移出屏幕，实测值会给出
`bottom = -57`，需要夹到 0 —— 这是「页头滑走但滚动条留着」的实现方式。

**路由切换后必须重测。** `ScrollBar` 挂在常驻的 `PageShell` 上，不会随
路由重建。从长文章跳到短页面时，`scrollY` 可能一直是 0（没有 scroll 事件），
唯一变化是文档变短了。所以组件里 `watch(route.path)` → `nextTick` → `refresh()`。
`ResizeObserver` 也能覆盖大部分情况，但那是副作用，不是契约。

**`v-show` 与 `is-shown` 是两层，别合并。** `v-show` 管「元素在不在树上」
（有内容可滚才在），`is-shown` 管「透明还是可见」。合并成一层的话，
淡入淡出就没过渡可做了。

几何与显隐策略都是纯函数（`support/scrollbar.ts`），有 23 个单测兜边界
（拇指长度永不越界、位置永不越界、`scrollTopForOffset` 与 `computeThumb` 互逆、
`shouldReveal` 的强制条件优先于超时）。**改规则先改测试，再改实现。**
