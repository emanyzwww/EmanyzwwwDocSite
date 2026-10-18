# 站点使用说明

这个站点是一套自包含的 Hugo 主题，不依赖任何第三方主题。
下面是你需要知道的一切—— **日常只写文章，其余基本不用碰**。

---

## 零、格式化（写完之后跑一下）

首次使用先装依赖：

```powershell
pnpm install
```

之后每次写完文章，执行：

```powershell
pnpm format
```

它会用 [oxfmt](https://oxc.rs)（内置 Prettier 3.9 的 Markdown 插件，快得多）整理 `content/`、`data/`、`assets/`、`i18n/` 和根级文档。

常用变体：

| 命令                                   | 作用                          |
| -------------------------------------- | ----------------------------- |
| `pnpm format`                          | 格式化全部                    |
| `pnpm format:check`                    | 只检查不写入，适合提交前或 CI |
| `pnpm format:md`                       | 只格式化内容与文档            |
| `pnpm format:theme`                    | 只格式化 CSS/JS               |
| `node scripts/format.js content/posts` | 只处理指定路径                |
| `node scripts/format.js --list`        | 列出会被改动的文件            |

**永不格式化的目录**：`layouts/`（Hugo 模板里 `aria-label="{{ i18n "postNav" }}"` 这类嵌套引号会让 HTML 解析器报错）、`public/`、`resources/`、`static/`、`node_modules/`。

格式化行为与 Prettier 一致：`*斜体*` → `_斜体_`、表格分隔线对齐、列表缩进规范化、多余空行合并。**front matter 与 Hugo 短代码 `{{< >}}` 不受影响**。

---

## 一、日常写文章

### 新建一篇文章

```powershell
hugo new content posts/我的文章名/index.zh-cn.md
```

或者手动创建目录 `content/posts/我的文章名/`，在里面建两个文件：

- `index.zh-cn.md` —— 中文版
- `index.en.md` —— 英文版（可选，没有也能正常用）

### 文章头部（front matter）

```toml
+++
title = '文章标题'
date = 2026-10-18T21:53:28+08:00
draft = false
summary = '一句话摘要，会显示在列表和 SEO 描述里'
tags = ['随笔', 'Hugo']
# categories = ['技术']   # 可选
# hideToc = true          # 可选，强制隐藏目录
# showReadingTime = true  # 可选，覆盖全局设置
+++
```

`draft = true` 时文章不会出现在正式构建里；本地预览用 `hugo server -D`。

### 在正文里放图片

把图片放进同目录，然后相对引用：

```markdown
![说明](cover.jpg)
```

### 换图不生效？放对目录就行

浏览器缓存是按 **URL** 来的。如果图片地址始终是同一个（比如 `/images/avatar.png`），
你换掉文件内容但没换文件名，浏览器会继续用缓存里的旧图。

本项目已经处理掉了这个问题，规则只有一条：

| 放哪里                  | 换图后是否自动生效                                                           |
| ----------------------- | ---------------------------------------------------------------------------- |
| `assets/images/xxx.png` | ✅ 会。构建时自动加内容指纹，URL 变成 `avatar.<hash>.png`，内容一变 URL 就变 |
| `static/images/xxx.png` | ❌ 不会。URL 固定不变，需要手动强制刷新（Ctrl+F5）                           |

所以**会被替换的图片请放在 `assets/images/` 下**，然后照常引用：

```yaml
# data/profile.yaml
avatar: /images/avatar.png     # 实际文件在 assets/images/avatar.png
```

模板里通过 `partials/asset-url.html` 解析，它会自动指纹化；找不到文件时回退到普通路径，
所以外链（`https://...`）和仍放在 `static/` 的老路径也都能正常工作。

> 正文里的图片（放在 `content/posts/xxx/` 内的）属于页面资源，文件名不变时同样可能被缓存，
> 需要时改名或用 Ctrl+F5 强制刷新。

### 本地预览与构建

```powershell
hugo server        # 本地预览，改完自动刷新
pnpm build         # 生成到 public/，用于部署（含清理旧指纹文件）
```

---

## 二、改个人信息（头像、名字、简介、社交链接）

**只需要改一个文件**：`data/profile.yaml`

```yaml
avatar: /images/avatar.png # 换头像就放一张图到 static/images/，改这里指向它
name: 你的名字
tagline: 名字下面那行小字
bio: |
  支持完整 Markdown 的自我介绍。
links:
  - label: GitHub
    url: https://github.com/你的用户名
    icon: github             # 可选 github / mail / rss / twitter / link
```

---

## 三、加/删侧栏组件

侧栏卡片的渲染顺序由 `hugo.toml` 里的这一行决定：

```toml
widgets = ['profile', 'tags', 'links', 'custom']
```

### 三种现成组件

| 名字      | 文件                                    | 内容来自                       |
| --------- | --------------------------------------- | ------------------------------ |
| `profile` | `layouts/partials/widgets/profile.html` | `data/profile.yaml`            |
| `tags`    | `layouts/partials/widgets/tags.html`    | 全站标签                       |
| `links`   | `layouts/partials/widgets/links.html`   | `data/profile.yaml` 的 `links` |
| `custom`  | `layouts/partials/widgets/custom.html`  | `data/widgets.yaml`            |

### 加一个自定义卡片（不用写模板）

编辑 `data/widgets.yaml`，照着加一条：

```yaml
- title: 我的新卡片
  content: |
    这里可以写 **Markdown**，也可以直接写 HTML。
```

### 加一个真正的自定义组件（写模板）

1. 新建 `layouts/partials/widgets/我的组件.html`，比如：

```html

<section class="card">
    <p class="card__title">现在时间</p>
    <p>{{ now.Format "2006-01-02 15:04" }}</p>
</section>
```

2. 在 `hugo.toml` 的 `widgets` 数组里加上 `'我的组件'`。

**就这样，除了这两处不用改任何别的文件。**

---

## 四、改样式（设计令牌系统）

所有视觉数值都在 `assets/css/tokens.css`，分三层：

1. **原始色板**（`--gray-900`、`--blue-600`……）—— 只定义颜色本身
2. **语义层**（`--bg-surface`、`--fg-default`、`--accent`……）—— 明暗主题在这里切换
3. **排版/间距/圆角**（`--text-lg`、`--space-4`、`--radius-md`……）

其余 CSS 文件 **只引用变量，不写死数值**。所以：

- 想换主色 → 改 `--blue-*` 色阶
- 想改圆角风格 → 改 `--radius-sm/md/lg`
- 想整体放大字号 → 改 `--text-base` 相关变量
- 想调整间距节奏 → 改 `--space-*`

样式文件分工：

| 文件             | 负责                           |
| ---------------- | ------------------------------ |
| `tokens.css`     | 全部设计变量                   |
| `base.css`       | 重置、基础排版、图标尺寸       |
| `layout.css`     | 页面骨架、卡片、按钮、标签     |
| `components.css` | 页头、页脚、主题/语言切换      |
| `content.css`    | 文章列表、正文排版、目录、分页 |
| `widgets.css`    | 侧栏组件                       |
| `syntax.css`     | 代码高亮                       |
| `print.css`      | 打印样式                       |

它们由 `partials/head.html` 按顺序拼接、压缩并加指纹，输出到 `/css/bundle.<hash>.css`。

---

## 五、暗色 / 亮色模式

- 默认跟随系统（`prefers-color-scheme`）
- 点页头的太阳/月亮按钮可手动切换，选择存在 `localStorage`
- 用户手动选择后，系统主题变化不再覆盖

主题标记写在 `<html data-theme="light|dark">`，所有颜色通过 CSS 变量响应。

---

## 六、多语言

- 默认语言：`zh-cn`，不放在子目录
- 英文在 `/en/` 下
- 页头语言按钮会自动找 **同一个页面的对应翻译**，找不到就回退到该语言首页

新增语言：在 `hugo.toml` 的 `[languages]` 下加一段，然后在 `i18n/` 里加对应语言文件。

---

## 七、导航菜单

在 `hugo.toml` 里，每种语言各一份：

```toml
[[languages.zh-cn.menus.main]]
name = '首页'
pageRef = '/'
weight = 10
```

`pageRef` 指向内容路径，比硬编码 URL 更安全（换域名不会失效）。

---

## 八、目录结构速查

```text
content/
  _index.zh-cn.md         首页文字
  posts/                  文章
  about/                  关于页
  tags/_index.zh-cn.md    标签页标题
data/
  profile.yaml            个人资料 ← 常改
  widgets.yaml            自定义卡片 ← 常改
assets/
  css/tokens.css          设计令牌 ← 想换风格改这里
  js/main.js              主题切换、语言菜单、目录高亮、复制代码
  images/avatar.png       会替换的图片放这里（自动加缓存指纹）
  favicon.svg
layouts/
  _default/               baseof / single / list / term / taxonomy
  partials/               页头、页脚、图标、组件
  partials/widgets/       侧栏组件（加文件即加组件）
i18n/                     界面文案
hugo.toml                 站点配置
```

---

## 九、已内置的功能

- 明暗主题切换（跟随系统 + 手动覆盖 + 无闪烁）
- 中英双语，语言按钮直达对应翻译页
- 文章目录，自动高亮当前章节
- 阅读进度条（有目录的长文章）
- 代码块一键复制
- 文章页时间线列表：按年份分组，一行一篇（日期 / 标题 / 摘要 / 时长 / 标签）
- 文章卡片列表、分页、上一篇/下一篇
- 标签 / 分类页（标签云 + 分组列表）
- 404 页面
- RSS、sitemap、robots.txt
- 自定义 404 与 SEO 元信息（Open Graph）
- 响应式（手机端页头自动分两行）
- 打印样式
- 无障碍：跳转链接、焦点环、aria 属性、`prefers-reduced-motion`
