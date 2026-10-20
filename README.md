# 站点使用说明

这个站点是 **VitePress 1.6.4 + TypeScript + 自定义主题**，不依赖第三方主题。
下面是日常需要知道的一切——**平时只写文章，其余基本不用碰**。

```powershell
pnpm install     # 首次
pnpm dev         # 本地预览，改完自动刷新
pnpm build       # 构建到 docs/.vitepress/dist
```

---

## 一、日常写文章

### 新建一篇文章

在 `docs/posts/` 下建一个目录，里面放 `index.md`：

```text
docs/posts/我的文章名/index.md
```

**为什么要建目录？** 这样 URL 是 `/posts/我的文章名/`（和你之前一样），
而且图片可以放在同一个目录里，用相对路径引用——迁移目录时图片跟着走。

### 文章头部（frontmatter）

```yaml
---
title: 文章标题
date: 2026-10-19T04:09:28+08:00
tags: ['随笔']
description: 一句话摘要，会显示在列表和 SEO 描述里
---
```

| 字段          | 说明                                                     |
| ------------- | -------------------------------------------------------- |
| `title`       | 必填，文章标题                                           |
| `date`        | 必填，`列表分组`与`上一篇/下一篇`都按它排序              |
| `tags`        | 可选，数组；新标签会自动生成标签页，**不用手写任何文件** |
| `description` | 可选，缺省时自动取正文第一段（截断 160 字）              |
| `outline`     | 可选，设为 `false` 可关掉右栏目录                        |

不需要写 `layout`：只有 `posts/` 下带 `date` 的页面才会被当成文章，
其余页面（关于、随便什么页）自动按普通文档渲染。

### 在正文里放图片

把图片放进同目录，然后相对引用：

```markdown
![说明](./banner.png)
```

### 换图不生效？放对目录就行

浏览器缓存是按 **URL** 来的。如果图片地址始终是同一个，你换掉文件内容但没换文件名，
浏览器会继续用缓存里的旧图。本项目的处理方式：

| 放哪里                    | 换图后是否自动生效                                                        |
| ------------------------- | ------------------------------------------------------------------------- |
| `docs/media/xxx.png`      | ✅ 会。构建时自动加内容指纹，URL 变成 `xxx.<hash>.png`，内容一变 URL 就变 |
| `docs/public/xxx.png`     | ❌ 不会。URL 固定不变，需要 Ctrl+F5 强制刷新                              |
| `docs/posts/文章/xxx.png` | ❌ 不会（页面资源），需要时改文件名                                       |

所以**会被替换的图片（头像、logo 等）请放在 `docs/media/` 下**，并在配置里只写文件名：

```ts
// docs/.vitepress/data/profile.ts
avatar: 'avatar.png' // 实际文件在 docs/media/avatar.png
```

组件通过 Vite 的资源导入解析，文件内容一变 URL 就变，缓存自动失效。

### 本地预览与构建

```powershell
pnpm dev        # 预览
pnpm build      # 生成 docs/.vitepress/dist
pnpm preview    # 预览构建产物（确认上线效果）
pnpm typecheck  # 类型检查（改了 TS / Vue 时跑一下）
```

---

## 二、改个人信息（头像、名字、简介、社交链接）

**只需要改一个文件**：`docs/.vitepress/data/profile.ts`

```ts
export const PROFILE: Profile = {
  avatar: 'avatar.png', // docs/media/ 下的文件名；留空则不显示头像
  name: 'Emanyzwww',
  tagline: '余晏舟',
  bio: '支持完整 Markdown 的自我介绍。',
  links: [
    { label: 'GitHub', url: 'https://github.com/你的用户名', icon: 'github' },
    // icon 可选：github / mail / rss / twitter / link
  ],
  tagsLimit: 20, // 侧栏标签卡最多显示几个标签
}
```

---

## 三、加/删侧栏组件

侧栏卡片的渲染顺序由 `docs/.vitepress/data/site.ts` 决定：

```ts
widgets: ['profile', 'tags', 'custom'],
```

| 名字      | 组件                               | 内容来自                     |
| --------- | ---------------------------------- | ---------------------------- |
| `profile` | `components/aside/ProfileCard.vue` | `data/profile.ts`            |
| `tags`    | `components/aside/TagsCard.vue`    | 全站标签                     |
| `links`   | `components/aside/LinksCard.vue`   | `data/profile.ts` 的 `links` |
| `custom`  | `components/aside/WidgetsCard.vue` | `data/widgets.ts`            |

### 加一张自定义卡片（不用写组件）

编辑 `docs/.vitepress/data/widgets.ts`，照着加一条：

```ts
{ title: '我的新卡片', content: '这里可以写 **Markdown**，也可以直接写 HTML。' }
```

`enabled: false` 可以临时停用一条（比删掉更适合「先放着」）。

### 加一个真正的自定义组件（写 Vue）

1. 新建 `docs/.vitepress/theme/components/aside/我的卡片.vue`
2. 在 `theme/components/aside/AsideWidgets.vue` 的 `REGISTRY` 里登记一行
3. 在 `data/site.ts` 的 `widgets` 数组里加上它的名字

比旧版多一步「登记」，换来的是**类型安全**：拼错名字在构建期就会报错，
而不是悄悄少渲染一张卡片。

---

## 四、改样式（设计令牌系统）

所有视觉数值都在 `docs/.vitepress/theme/styles/tokens.css`，分三层：

1. **原始层**（`--gray-900`、`--blue-600`……）—— 只定义颜色本身
2. **语义层**（`--bg-surface`、`--fg-muted`、`--accent`……）—— 明暗主题在这一层切换
3. **排版/间距/圆角/布局**（`--text-lg`、`--space-4`、`--radius-md`……）

其余 CSS **只引用变量，不写死数值**。所以：

- 想换主色 → 改 `--blue-*` 色阶
- 想改圆角风格 → 改 `--radius-sm/md/lg`
- 想整体放大字号 → 改 `--text-*`
- 想调整间距节奏 → 改 `--space-*`

样式文件分工：

| 文件             | 负责                                 |
| ---------------- | ------------------------------------ |
| `tokens.css`     | 全部设计变量                         |
| `base.css`       | 重置、基础排版、图标尺寸、滚动条     |
| `layout.css`     | 容器、两栏/三栏网格、粘性侧栏        |
| `components.css` | 页头、页脚、按钮、卡片、标签         |
| `content.css`    | 正文排版、代码块与复制按钮、表格     |
| `posts.css`      | 时间线、文章卡片、目录、分页、上下篇 |
| `widgets.css`    | 侧栏卡片与标签云/标签分组            |
| `print.css`      | 打印样式                             |
| `index.css`      | 入口，按上面的顺序 `@import`         |

### 代码格式化

```powershell
pnpm format        # 格式化：docs 下的 md / ts / vue / css，以及 README
pnpm format:check  # 只检查不写入（提交前或 CI 用）
```

**格式化范围包括主题代码**：`docs/.vitepress/theme/**` 下的 `.vue`、`.ts` 和
`docs/.vitepress/**` 下的配置与构建期脚本都在内，改完主题顺手跑一下即可。

默认不处理：`node_modules`、`docs/public`（原样输出的静态资源）、
`docs/.vitepress/{dist,cache}`（构建产物）、锁文件。

两个与 Vue 有关的细节（`oxfmt` 的行为，已配置好，了解即可）：

1. `.vue` 的属性只在超长时才换行（见 `.oxfmtrc.json` 里 `**/*.vue` 的覆盖）。
   若沿用全局的 `singleAttributePerLine`，每个属性都会独占一行，模板会膨胀两三倍。
2. `oxfmt` 会把所有 `import` 提到 `<script setup>` 最前面，**因此组件说明注释不要写在
   import 之上**——否则会被留在原地，夹在两条 import 中间。正确位置是放在
   import 块之后、第一条语句之前。

---

## 五、暗色 / 亮色模式

由 VitePress 负责：默认跟随系统、点页头按钮手动切换、选择存在 `localStorage`，
并且**首屏不会闪烁**（`<head>` 里有一段比应用更早执行的初始化脚本）。

主题标记是 `<html class="dark">`，因此自定义样式里写 `.dark { … }` 即可。

---

## 六、多语言

- 默认语言：简体中文，不放在子目录（`docs/`）
- 英文：`docs/en/` 下同构放一份
- 页头语言按钮的行为：
  1. 有对应翻译页 → 直达（`/posts/hello-world/` ↔ `/en/posts/hello-world/`）
  2. 没有 → 退到目标语言的同栏目索引（`/en/posts/`）
  3. 再没有 → 退到目标语言首页

新增语言：`data/site.ts` 加一条 `LOCALES`、`config.ts` 的 `locales` 加一段、
`theme/i18n/` 加一份文案（`Messages` 类型会强制你补齐所有键）。

---

## 七、导航菜单

在 `docs/.vitepress/data/site.ts` 里，每种语言一份：

```ts
export const NAV = {
  root: [{ text: '首页', link: '/' } /* … */],
  en: [{ text: 'Home', link: '/en/' } /* … */],
}
```

链接用**目录式路径**（`/posts/`），与内容文件一一对应；高亮由路径前缀自动判断。

---

## 八、目录结构速查

```text
docs/
  index.md                  首页（layout: home）
  posts/
    index.md                文章列表（layout: posts）
    page/[page]/index.md    第 2 页起的模板（自动生成路由）
    hello-world/index.md    一篇文章
  about/index.md            关于页
  tags/
    index.md                标签总览（layout: tags）
    [tag]/index.md          标签详情模板（自动生成路由）
  en/                       英文站，结构与上同构
  media/avatar.png          会被替换的站点图片（自动加指纹）
  public/                   原样拷贝：favicon、robots.txt、.nojekyll

  .vitepress/
    config.ts               站点配置（路由、SEO、RSS）
    types.ts                全站类型
    data/
      site.ts               站点信息、导航、页脚、侧栏顺序 ← 常改
      profile.ts            个人信息 ← 常改
      widgets.ts            自定义卡片 ← 常改
      taxonomy.ts           标签 slug / 名称覆盖（可选）
      *.data.ts             数据加载器（构建期生成 JSON）
    support/                构建期工具：内容解析、Markdown、RSS、格式化
    theme/
      Layout.vue            路由分发（看 frontmatter.layout）
      components/           pages / layout / site / post / tag / aside / common
      composables/          文章、标签、分页、目录高亮、进度条、语言切换
      i18n/                 界面文案（中/英）
      styles/               分层样式
      support/              图标表、路径工具、媒体解析
```

---

## 九、已内置的功能

- 明暗主题切换（跟随系统 + 手动覆盖 + 无闪烁）
- 中英双语，语言按钮直达对应翻译页（逐级回退）
- 文章目录，自动高亮当前章节
- 阅读进度条（文章页顶部）
- 代码块一键复制（悬停出现，提示语跟随语言）
- 文章列表：按年份分组的时间线（日期 / 标题 / 摘要 / 字数 / 标签）
- 分页（每页 10 篇，构建期生成路由）、文章卡片、上一篇/下一篇
- 标签云（按文章数分级字号）+ 标签分组总览 + 标签详情页
- 404 页面、RSS（全文）、sitemap、robots.txt、Open Graph
- 响应式（手机端页头分两行、三栏降为单栏）
- 打印样式
- 无障碍：跳转链接、焦点环、`aria-*`、`prefers-reduced-motion`

---

## 十、从 Hugo 迁过来的话

| 旧（Hugo）                       | 新（VitePress）                              |
| -------------------------------- | -------------------------------------------- |
| `hugo.toml`                      | `docs/.vitepress/config.ts` + `data/site.ts` |
| `content/posts/x/index.zh-cn.md` | `docs/posts/x/index.md`                      |
| `content/posts/x/index.en.md`    | `docs/en/posts/x/index.md`                   |
| `data/profile.yaml`              | `data/profile.ts`                            |
| `data/widgets.yaml`              | `data/widgets.ts`                            |
| `i18n/*.toml`                    | `theme/i18n/*.ts`                            |
| `layouts/**`                     | `theme/**`（Vue 组件）                       |
| `assets/css/*`                   | `theme/styles/*`                             |
| `assets/images/`                 | `docs/media/`                                |
| `static/`                        | `docs/public/`                               |
| `hugo new content …`             | 直接建目录和 `index.md`                      |
| frontmatter `+++`（TOML）        | frontmatter `---`（YAML）                    |

旧的 URL 全部保持不变（`/posts/hello-world/`、`/tags/随笔/`、`/en/…`），
因此不需要配任何跳转规则。
