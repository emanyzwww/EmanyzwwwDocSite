+++
title = '关于'
description = '关于这个站点，以及怎么改它。'
+++

这个页面是给你自己写的——换成你的自我介绍、经历、联系方式都行。
文件在 `content/about/index.zh-cn.md`，直接改这里的内容即可。

## 关于这个主题

它没有依赖任何第三方主题，全部模板和样式都在仓库里：

- `assets/css/tokens.css` —— **所有**颜色、字号、间距、圆角都在这里，
  改这一个文件就能整体换掉视觉风格，其他地方不写死任何数值。
- `assets/css/*.css` —— 按职责拆分的样式（基础、布局、组件、内容、侧栏）。
- `layouts/` —— 模板，组件都是 partial，可以自由删改。
- `data/profile.yaml` —— 头像、名字、简介、社交链接。
- `data/widgets.yaml` —— 侧栏里那些自定义卡片，加一条就多一张。

## 你可以随便加东西

这个主题没打算把你锁死在某一种结构里。比如想加个新组件：

```text
layouts/partials/widgets/music.html   ← 新建
hugo.toml 里 widgets = [..., 'music'] ← 注册
```

不想要某个组件，从数组里删掉就行，模板不用动。

## 联系我

- GitHub：<https://github.com/>
- 邮箱：<mailto:you@example.com>
