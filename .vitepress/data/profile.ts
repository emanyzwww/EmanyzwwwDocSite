/**
 * 个人资料。
 *
 * 头像只写文件名，实际文件放在 `media/`：
 * 组件通过 Vite 的资源导入解析成带内容指纹的 URL，
 * 因此「换图不换文件名」也会立刻生效（浏览器缓存自动失效）。
 */

import type { Profile } from '../types'

export const PROFILE: Profile = {
  /*
   * 头像文件名（位于 `media/`）；留空则不显示头像。
   *
   * 用 160×160 WebP，而不是原来那张 640×640 的「avatar.png」：
   * - 那个文件其实是 JPEG（魔数 FF D8 FF E0），却以 image/png 下发；
   * - 显示尺寸只有 80×80 CSS px（2x 屏也只要 160px），640 的像素完全浪费。
   *
   * 换成 160×160 WebP 后从 41.9KB 降到 4.5KB（-89%），
   * 首屏传输量因此少了约四分之一。
   */
  avatar: 'avatar.webp',

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
