/**
 * 个人资料。
 *
 * 头像只写文件名，实际文件放在 `docs/media/`：
 * 组件通过 Vite 的资源导入解析成带内容指纹的 URL，
 * 因此「换图不换文件名」也会立刻生效（浏览器缓存自动失效）。
 */

import type { Profile } from '../types'

export const PROFILE: Profile = {
  // 头像文件名（位于 docs/media/）；留空则不显示头像
  avatar: 'avatar.png',

  name: 'Emanyzwww',

  // 名字下方的一行小字
  tagline: '余晏舟',

  // 自我介绍，支持完整 Markdown
  bio: '你好，我是一个喜欢把想法写下来的人。',

  // 社交 / 联系方式。icon 可选：github / mail / rss / twitter / link
  links: [
    { label: 'GitHub', url: 'https://github.com/emanyzwww', icon: 'github' },
    { label: 'Twitter', url: 'https://x.com/emanyzwww', icon: 'twitter' },
    { label: '邮箱', url: 'mailto:emanyzwww@gmail.com', icon: 'mail' },
    { label: 'RSS', url: '/index.xml', icon: 'rss' },
  ],

  // 侧栏标签卡最多显示几个标签
  tagsLimit: 20,
}
