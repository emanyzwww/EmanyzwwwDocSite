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
    ▼
theme/Layout.vue
    │  ④ 按 frontmatter.layout 选页面组件
    │     composables 读 posts.data 的 JSON，算标签/分页/上下篇
    ▼
Vue 组件  ──►  HTML
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
│  ├─ markdown.ts         Markdown → HTML（bio / widgets / RSS 正文）
│  ├─ markdown-plugins.ts 自写扩展语法：`==高亮==`、GFM 任务列表
│  ├─ rss.ts              RSS 生成（buildEnd 调用）
│  ├─ robots.ts           robots.txt 生成（buildEnd 调用）
│  └─ dev-redirect.ts     dev 下 `/` 按 Accept-Language 跳语言
│
├─ dist/                  构建产物（gitignore）
├─ cache/                 Vite 依赖缓存（gitignore）
│
└─ theme/                 运行期代码（浏览器）
   ├─ index.ts            主题入口：引样式 + 复制按钮本地化
   ├─ Layout.vue          ★ 按 frontmatter.layout 分发页面组件
   ├─ i18n/               界面文案（zh-cn / en / index）
   ├─ composables/        组合式函数：文章、标签、分页、目录高亮、进度条、语言、移动端状态
   ├─ components/
   │  ├─ pages/           ★ 六个页面级组件（Home/Posts/Doc/Tags/Tag/NotFound）
   │  ├─ layout/          外壳：PageShell、TwoColumn、ThreeColumn
   │  ├─ site/            页头、页脚、导航、搜索面板、主题切换、语言切换
   │  ├─ mobile/          移动端专属：导航抽屉（MobileNav）、悬浮胶囊（MobileDock）
   │  ├─ post/            文章卡片、时间线、元信息、上下篇、分页
   │  ├─ tag/             标签云、标签分组、其他标签
   │  ├─ aside/           侧栏：容器 + 7 个卡片组件（注册表里可选 4 种）
   │  └─ common/          图标、空状态、进度条
   ├─ support/            浏览器侧工具：图标表、路径、媒体、分页、滚动
   └─ styles/             11 个分层样式

docs/                      ← 只有内容
├─ zh-cn/                 中文站（URL `/zh-cn/`）
│  ├─ index.md            首页（layout: home）
│  ├─ about/index.md
│  ├─ posts/              文章（含 page/[page]/ 分页动态路由）
│  └─ tags/               标签总览 + [tag]/ 动态路由
└─ en/                    英文站（URL `/en/`），结构完全对应

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

### 两类 `support/` 的区别（容易混）

|                | `.vitepress/support/`                  | `.vitepress/theme/support/` |
| -------------- | -------------------------------------- | --------------------------- |
| 运行环境       | 构建期（Node）                         | 浏览器                      |
| 能用 `node:fs` | ✅                                     | ❌                          |
| 典型内容       | 读文件、生成 RSS                       | 路径拼接、图标表、滚动监听  |
| 被谁引用       | `config.ts`、`*.data.ts`、`*.paths.ts` | Vue 组件                    |

例外：`format.ts` 在构建期目录里，但它是纯函数，两边都能用。

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

| 想改           | 位置                                                 |
| -------------- | ---------------------------------------------------- |
| 代码高亮主题   | `markdown.theme`（当前 `github-dark-default`）       |
| 目录收几级标题 | `markdown.headers.level`（当前 `[2, 3]`，可加 4）    |
| 草稿目录       | `srcExclude`（当前含 `**/_drafts/**`）               |
| 锚点跳转偏移   | `scrollOffset`（当前 80，配合 4rem 页头）            |
| 站点地图域名   | `SITEMAP_HOSTNAME`（自动 = 站点 origin + `VP_BASE`） |
| 页头 meta      | `head` 数组                                          |
| 页面标题怎么拼 | `transformPageData`                                  |
| OG / RSS 标签  | `transformHead`                                      |
| RSS 生成逻辑   | `buildEnd` → `support/rss.ts`                        |
| robots.txt     | `buildEnd` → `support/robots.ts`                     |

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

### 十一个样式文件的职责

顺序在 `styles/index.css` 里，后面的能覆盖前面的。

| 文件             | 管什么                                                      | 什么时候进这里改             |
| ---------------- | ----------------------------------------------------------- | ---------------------------- |
| `tokens.css`     | 全部设计变量（含 z 轴阶梯、安全区与停靠高度）               | 换色、换圆角、换字号、换间距 |
| `base.css`       | 重置、body、a、图标尺寸、自绘滚动条、焦点环、跳转链接       | 调基础排版、改滚动条         |
| `layout.css`     | 容器、两栏/三栏网格、粘性侧栏、断点                         | 改整体骨架、侧栏宽度         |
| `components.css` | 页头、页脚、导航、搜索入口、按钮、卡片、标签、徽章、空状态  | 改页头页脚、按钮样式         |
| `content.css`    | **正文专属**：标题、段落、列表、引用、表格、代码块、图片    | 改文章正文观感               |
| `posts.css`      | 时间线、文章卡片、文章头尾、目录、分页、上下篇、进度条、404 | 改列表和文章页               |
| `widgets.css`    | 资料卡、自定义卡片、标签云、标签分组、其他标签              | 改侧栏卡片                   |
| `mobile.css`     | 页头隐藏、导航抽屉、悬浮胶囊、目录浮层、手机断点布局        | 改移动端交互                 |
| `search.css`     | 全站搜索面板                                                | 改搜索面板                   |
| `print.css`      | 打印样式                                                    | 调打印                       |
| `index.css`      | `@import` 汇总，别放规则                                    | 加新样式文件时登记           |

> **`content.css` 必须排在 `posts.css` 之前。**
> `posts.css` 里有一条 `.prose h2` 的移动端缩小规则，需要压过
> `content.css` 的正文默认值。调整 `@import` 顺序时注意这条依赖。

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

| 文件                 | 提供什么                                     |
| -------------------- | -------------------------------------------- |
| `usePosts`           | 当前语言的全部文章（已排序、已剔草稿）       |
| `useTaxonomy`        | 当前语言的标签汇总（含每个标签的文章）       |
| `useCurrentPost`     | 当前页面匹配到的文章（判断「是不是文章页」） |
| `useAdjacentPosts`   | 上一篇 / 下一篇                              |
| `useLocaleSwitch`    | 语言切换的选项与目标地址                     |
| `useActiveAnchor`    | 目录高亮（当前滚动到哪一节）                 |
| `useReadingProgress` | 阅读进度 0–1                                 |
| `useDockState`       | 移动端「阅读态」：页头隐藏 / 胶囊收成圆      |
| `useScrollBar`       | 自绘滚动条：拇指长度、位置与拖拽             |

**`useDockState` 是模块级单例，可以多处调用**
（`SiteHeader` 与 `MobileDock` 就各调了一次），不会重复绑定事件。
不要改成「每个组件各持一份 ref」——那样两个组件会算出不同结论，
表现为「页头藏了但胶囊没缩」这类诡异 bug。

`useScrollBar` 不是单例（只有 `ScrollBar` 一个消费者），但它**复用
`useScrollEffect`** 这个全站唯一的滚动订阅。要加新的「滚动联动」效果，
照它的样子接进去，不要自己 `addEventListener('scroll')`。

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

### 加一个动态路由

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

```json
{
  "scripts": {
    "check": "pnpm typecheck && pnpm format:check"
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
pnpm format        # 格式化：docs + .vitepress + 根目录几份 md
pnpm format:check  # 只检查不写入
pnpm build         # 构建（也会暴露类型问题）
```

改完代码的标准流程：`format` → `lint` → `typecheck` → `test` → `build`。

> 注意 `format` 现在显式带上了 `.vitepress`——它已经不在 `docs/` 里了，
> 只写 `docs` 会漏掉主题代码。

### 单测覆盖什么

`tests/` 下只测**纯函数**（不依赖 VitePress 运行时、不读磁盘）：

| 文件                       | 覆盖                                                       |
| -------------------------- | ---------------------------------------------------------- |
| `urls.test.ts`             | 相对路径 → URL、中文编码、与 `decodePath` 互逆             |
| `paths.test.ts`            | 语言前缀换算、`asLocale`、`postListPath`、`LOCALES` 一致性 |
| `pagination.test.ts`       | 分页边界（空列表、越界、非法 perPage）                     |
| `format.test.ts`           | 日期格式化、RFC 822、字数统计、纯文本化                    |
| `dev-redirect.test.ts`     | `Accept-Language` 解析                                     |
| `markdown-plugins.test.ts` | `==高亮==` 与任务列表的渲染、嵌套、不误伤比较运算          |

为了让这些函数能在 Node 里跑，纯逻辑刻意放在
`.vitepress/support/urls.ts` 与 `.vitepress/support/locale-paths.ts`，
**不 import `vitepress`**；需要 `withBase` 的包装留在 `theme/support/paths.ts`。

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
这里只记改代码时的三件事。

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

几何计算是纯函数（`support/scrollbar.ts`），有 15 个单测兜边界
（拇指长度永不越界、位置永不越界、`scrollTopForOffset` 与 `computeThumb` 互逆）。
**改映射规则先改测试，再改实现。**
