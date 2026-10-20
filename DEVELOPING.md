# 代码维护指南

**这份文档只讲一件事：怎么改代码。** 写作请看 [WRITING.md](./WRITING.md)。

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
docs/**/*.md
    │
    │  ① support/content.ts 扫描全部 .md，解析 frontmatter
    │     算出：url / 标题 / 摘要 / 字数 / 标签 / 日期文本 / 语言
    ▼
data/posts.data.ts  ──►  PostSummary[]  ──►  序列化成 JSON 内联进客户端
    │
    │  ② 同时：docs/{tags,posts}/**/index.paths.ts 用同一份数据
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
    │  ⑤ buildEnd 用同一份数据再生成 RSS
    ▼
docs/.vitepress/dist/
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
docs/.vitepress/
├─ config.ts              构建配置：路由、Markdown、SEO、RSS。改「站点行为」看这里
├─ types.ts               全站类型。加字段先改这里，TS 会告诉你哪儿还没适配
├─ env.d.ts               import.meta.glob 与 .vue 的类型声明
│
├─ data/                  纯数据与数据加载器（*.data.ts 是加载器）
│  ├─ site.ts             ★ 站点名、域名、导航、页脚、分页数、侧栏顺序
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
│  └─ rss.ts              RSS 生成（buildEnd 调用）
│
└─ theme/                 运行期代码（浏览器）
   ├─ index.ts            主题入口：引样式 + 复制按钮本地化
   ├─ Layout.vue          ★ 按 frontmatter.layout 分发页面组件
   ├─ i18n/               界面文案（zh-cn / en / index）
   ├─ composables/        组合式函数：文章、标签、分页、目录高亮、进度条、语言
   ├─ components/
   │  ├─ pages/           ★ 六个页面级组件（Home/Posts/Doc/Tags/Tag/NotFound）
   │  ├─ layout/          外壳：PageShell、TwoColumn、ThreeColumn
   │  ├─ site/            页头、页脚、导航、主题切换、语言切换
   │  ├─ post/            文章卡片、时间线、元信息、上下篇、分页
   │  ├─ tag/             标签云、标签分组、其他标签
   │  ├─ aside/           侧栏：容器 + 7 种卡片
   │  └─ common/          图标、空状态、进度条
   ├─ support/            浏览器侧工具：图标表、路径、媒体、分页、滚动
   └─ styles/             9 个分层样式
```

带 ★ 的是**日常最常改的**。

### 两类 `support/` 的区别（容易混）

|                | `docs/.vitepress/support/`             | `docs/.vitepress/theme/support/` |
| -------------- | -------------------------------------- | -------------------------------- |
| 运行环境       | 构建期（Node）                         | 浏览器                           |
| 能用 `node:fs` | ✅                                     | ❌                               |
| 典型内容       | 读文件、生成 RSS                       | 路径拼接、图标表、滚动监听       |
| 被谁引用       | `config.ts`、`*.data.ts`、`*.paths.ts` | Vue 组件                         |

例外：`format.ts` 在构建期目录里，但它是纯函数，两边都能用。

---

## 三、改站点配置

### `data/site.ts` —— 站点层面的一切

```ts
const SITE_URL = 'https://emanyzoo.cn' // 域名（sitemap / RSS 用）
const SITE_NAME = 'Emanyzwww' // 品牌名（页头 / 页脚 / 标题后缀）
const TIME_ZONE = 'Asia/Shanghai' // 日期显示时区

export const SITE: SiteMeta = {
  postsPerPage: 10, // 每页文章数
  homePostCount: 5, // 首页显示几篇
  outline: true, // 是否生成右栏目录（全局开关）
  wordCount: true, // 是否显示字数
  widgets: ['profile', 'tags', 'custom'], // 侧栏卡片顺序
  footer: {/* 版权、附加文字、链接 */},
}
```

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

### 改导航

```ts
export const NAV = {
  root: [
    { text: '首页', link: '/' },
    { text: '文章', link: '/posts/' },
    { text: '标签', link: '/tags/' },
    { text: '关于', link: '/about/' },
  ],
  en: [/* 英文版 */],
}
```

- `link` 用**目录式路径**（`/posts/`），不要写 `.html`，不要写相对路径
- 高亮自动判断：当前路径等于该项或以该项为前缀
- 首页特殊处理：只做精确匹配，否则所有页面都会点亮首页
- 加一项就是加一行；**英文和中文要分别加**

### `data/profile.ts` —— 个人信息

```ts
export const PROFILE: Profile = {
  avatar: 'avatar.png', // docs/media/ 下的文件名
  name: 'Emanyzwww',
  tagline: '余晏舟',
  bio: '支持 Markdown',
  links: [{ label: 'GitHub', url: 'https://...', icon: 'github' }],
  tagsLimit: 20, // 侧栏标签卡上限
}
```

`icon` 可选值见 `types.ts` 的 `IconName`；加新图标要改 `theme/support/icons.ts`（见第五节）。

### `config.ts` —— 构建行为

| 想改           | 位置                                      |
| -------------- | ----------------------------------------- |
| 代码高亮主题   | `markdown.theme`（当前 `github-dark`）    |
| 目录收几级标题 | `markdown.headers.level`（当前 `[2, 3]`） |
| 草稿目录       | `srcExclude`（当前含 `**/_drafts/**`）    |
| 锚点跳转偏移   | `scrollOffset`（当前 80，配合 4rem 页头） |
| 站点地图域名   | `sitemap.hostname`                        |
| 页头 meta      | `head` 数组                               |
| 页面标题怎么拼 | `transformPageData`                       |
| OG / RSS 标签  | `transformHead`                           |
| RSS 生成逻辑   | `buildEnd` → `support/rss.ts`             |

### 部署路径

`config.ts` 里两个环境变量：

```ts
const BASE = process.env.VP_BASE ?? '/' // 部署根路径
const SITE_URL = process.env.VP_SITE_URL ?? SITE.url // 绝对地址
```

CI 会自动算好这两个值传给构建（见 `.github/workflows/deploy.yml`）。本地不用管。

---

## 四、改样式

### 三层令牌制度

**核心规则：其他 CSS 只引用变量，不写死数值。**

`theme/styles/tokens.css`：

```css
/* 1. 原始层：颜色本身 */
:root {
  --gray-900: #181b20;
  --blue-600: #3358d9;
}

/* 2. 语义层：按用途命名，明暗主题在这里切换 */
:root {
  --bg-canvas: var(--gray-50);
  --fg-default: var(--gray-900);
  --accent: var(--blue-600);
  --border-subtle: var(--gray-200);
}
.dark {
  --bg-canvas: var(--gray-950);
  --fg-default: #e6e8ec;
  --accent: var(--blue-300);
}

/* 3. 排版 / 间距 / 圆角 —— 不随主题变 */
:root {
  --text-md: 1.0625rem;
  --space-4: 1rem;
  --radius-lg: 14px;
  --layout-max: 82rem;
  --aside-width: 16rem;
}
```

### 常见改动

| 想改          | 改哪个变量                                   |
| ------------- | -------------------------------------------- |
| 主色 / 强调色 | `--blue-*` 色阶（或直接改 `--accent`）       |
| 圆角风格      | `--radius-sm/md/lg/xl`                       |
| 整体字号      | `--text-*`                                   |
| 间距节奏      | `--space-*`（4px 基准）                      |
| 正文字体      | `--font-sans` / `--font-mono`                |
| 主体宽度      | `--layout-max`                               |
| 侧栏宽度      | `--aside-width`                              |
| 页头高度      | `--header-height`（改后注意 `scrollOffset`） |
| 明暗两套配色  | 分别改 `:root` 和 `.dark` 的语义层           |

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

### 九个样式文件的职责

顺序在 `styles/index.css` 里，后面的能覆盖前面的。

| 文件             | 管什么                                                      | 什么时候进这里改             |
| ---------------- | ----------------------------------------------------------- | ---------------------------- |
| `tokens.css`     | 全部设计变量                                                | 换色、换圆角、换字号、换间距 |
| `base.css`       | 重置、body、a、图标尺寸、滚动条、焦点环、跳转链接           | 调基础排版、改滚动条         |
| `layout.css`     | 容器、两栏/三栏网格、粘性侧栏、断点                         | 改整体骨架、侧栏宽度         |
| `components.css` | 页头、页脚、导航、按钮、卡片、标签、徽章、统计列表、空状态  | 改页头页脚、按钮样式         |
| `content.css`    | 正文排版、标题、代码块与复制按钮、表格、图片、提示容器      | 改文章正文观感               |
| `posts.css`      | 时间线、文章卡片、文章头尾、目录、分页、上下篇、进度条、404 | 改列表和文章页               |
| `widgets.css`    | 资料卡、自定义卡片、标签云、标签分组、其他标签              | 改侧栏卡片                   |
| `print.css`      | 打印样式                                                    | 调打印                       |
| `index.css`      | `@import` 汇总，别放规则                                    | 加新样式文件时登记           |

### 响应式断点

| 断点                | 行为                                 |
| ------------------- | ------------------------------------ |
| `max-width: 1120px` | 三栏 → 单栏（右栏目录移到正文下方）  |
| `max-width: 960px`  | 两栏 → 单栏（侧栏移到正文下方）      |
| `max-width: 720px`  | 页头分两行、标题缩小、时间线收成两行 |
| `max-width: 640px`  | 上下篇变单列                         |

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

| 组件          | 结构                                          | 用在哪                  |
| ------------- | --------------------------------------------- | ----------------------- |
| `PageShell`   | 跳转链接 + 页头 + `<main>` + 页脚             | `Layout.vue` 包在最外层 |
| `TwoColumn`   | 左侧栏 + 主内容                               | 首页、列表、普通页      |
| `ThreeColumn` | 左侧栏 + 主内容 + 右侧栏（具名插槽 `#aside`） | 文章页、标签页          |

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
| `useLocaleSwitch`    | 语言下拉的选项与目标地址                     |
| `useActiveAnchor`    | 目录高亮（当前滚动到哪一节）                 |
| `useReadingProgress` | 阅读进度 0–1                                 |

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

`docs/tags/[tag]/index.md` 是模板，`index.paths.ts`（构建期跑）生成具体路由：

```ts
export default {
  watch: ['../../../**/*.md'], // 文章变了就重新生成

  paths() {
    const slugs = new Set<string>()
    for (const post of readPosts('root')) {
      for (const tag of post.tags) slugs.add(tag.slug)
    }
    return [...slugs].sort().map((tag) => ({ params: { tag } }))
  },
}
```

所以：**文章加了新标签 → 自动出现标签页**，不需要写文件。

同理，`docs/posts/page/[page]/index.paths.ts` 生成分页路由（第 2 页起）。

> 注意：VitePress 1.6.4 **没有** `defineRoutes` 辅助函数（2.x 才有），
> 所以这里是裸 `export default`，别写成 `defineRoutes({...})`。

### 标签 URL 转英文

默认标签名即 URL（`/tags/随笔/`）。想变英文，改 `data/taxonomy.ts`：

```ts
export const TAG_SLUGS: Record<string, string> = {
  随笔: 'essay', // /tags/随笔/ → /tags/essay/
  工具: 'tools',
}

export const TAG_LABELS: Record<string, string> = {
  随笔: '随笔', // 展示名（可用来统一大小写）
}
```

**改 slug = 换地址 = 旧链接 404**。要保留旧链接，在 `docs/public/` 放跳转页。

### 分页

第 1 页是 `/posts/`，第 2 页起是 `/posts/page/N/`。

- 每页几篇：`site.ts` 的 `postsPerPage`
- 分页计算：`theme/support/pagination.ts`（纯函数）
- 页码越界会自动夹到 `[1, totalPages]`，不会白屏

### 加一个动态路由

比如「按年份归档」`/archive/2026/`：

**① 建模板** `docs/archive/[year]/index.md`：

```markdown
---
layout: archive
title: 归档
---
```

**② 建生成器** `docs/archive/[year]/index.paths.ts`：

```ts
import { readPosts } from '../../.vitepress/support/content'

export default {
  watch: ['../../../**/*.md'],
  paths() {
    const years = new Set(readPosts('root').map((post) => post.year))
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

**注意**：`index.paths.ts` 里引用 `.vitepress` 下的代码要用相对路径
（`../../.vitepress/support/content`），因为它在内容目录里，不在 `.vitepress` 下。

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
④ types.ts → LocaleCode 改成只有 'root'（TS 会指出所有要改的地方）
⑤ theme/i18n/ → 删 en.ts，MESSAGES 删对应项
⑥ 组件里的语言下拉会自动只剩一项（LocaleSwitch 的逻辑会处理）
```

`LocaleCode` 这个联合类型是这套设计的关键——**改它，编译器会带你走完全部改动点**。

---

## 九、格式化与类型检查

### 命令

```powershell
pnpm typecheck     # TS + Vue 类型检查（0 错误才算过）
pnpm format        # 格式化：docs（含主题代码）+ README
pnpm format:check  # 只检查不写入
pnpm build         # 构建（也会暴露类型问题）
```

改完代码的标准流程：`format` → `typecheck` → `build`。

### 格式化覆盖什么

`.oxfmtignore` 排除了这些：

```text
node_modules / .pnpm-store / .npm-cache
docs/.vitepress/dist / docs/.vitepress/cache
docs/public          # 原样输出的静态资源
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
3. `pnpm build` 后上传 `docs/.vitepress/dist`

本地不用配任何东西。

### 需要人工确认的

- 仓库 Settings → Pages → Source 必须是 **GitHub Actions**
- 绑定自定义域名时：
  - `docs/public/CNAME` 写域名
  - `data/site.ts` 的 `SITE_URL` 改成同一域名
  - 仓库变量 `SITE_URL` 也改成同一域名

### 改域名要动的地方

```text
① data/site.ts → SITE_URL
② docs/public/CNAME（如用自定义域名）
③ 仓库变量 SITE_URL（可选，覆盖 CI 里的绝对地址）
④ docs/public/robots.txt 里的 Sitemap 地址
```

`SITE_URL` 影响：sitemap 的 `<loc>`、RSS 的绝对链接、canonical、OG `og:url`。

---

## 附：设计决策速查

几个「当时为什么这么做」的记录，避免以后推翻重来。

| 决策                                          | 理由                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| 完全自定义主题，不 extends 默认主题           | 默认主题 DOM 与样式高度耦合，还原三栏 + 卡片侧栏要大量覆盖，反而更难维护 |
| 目录式 URL（`cleanUrls: false`）              | 不依赖服务器把 `/x` 映射到 `/x.html`，任何静态托管都能跑                 |
| Shiki 单主题 `github-dark`                    | 原站代码块在明暗两套下都是深色；单主题省掉双主题 CSS 变量切换            |
| 字数在构建期计算                              | 汉字按字、拉丁按词；客户端零成本                                         |
| 日期固定 `Asia/Shanghai`                      | 避免构建机时区不同导致跨日                                               |
| 数据加载器返回摘要数组，标签/统计在客户端派生 | 文章量小，一份数组足够；避免多份索引不一致                               |
| `LocaleCode` 用联合类型                       | 改语言集合时，TS 会指出所有需要适配的位置                                |
| 标签页用动态路由 + `paths()`                  | 新增标签无需手写文件，是静态博客最容易腐化的地方                         |
| 侧栏用注册表而非约定式                        | 名字拼错在构建期报错，而不是悄悄少渲染                                   |
