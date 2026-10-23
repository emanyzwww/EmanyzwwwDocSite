<script setup lang="ts">
import { useRoute } from 'vitepress'
import { onBeforeUnmount, ref, watch } from 'vue'

import { NAV, SITE } from '../../../data/site'
import { useI18n } from '../../i18n'
import { href, stripRouteBase } from '../../support/paths'
import AppIcon from '../common/AppIcon.vue'
import LocaleSwitch from '../site/LocaleSwitch.vue'
import ThemeToggle from '../site/ThemeToggle.vue'

/**
 * 移动端导航抽屉。
 *
 * **为什么不复用桌面页头**：桌面把「品牌 + 4 个导航项 + 主题 + 语言」
 * 压在一行里，靠水平排布降低视觉重量。窄屏照搬的结果是换行成两行、
 * 页头高度翻倍（实测 65px → 150px），既挤占首屏，又会把
 * `--header-height` 这个布局契约顶破（进度条被盖住、锚点跳转被遮挡）。
 *
 * 移动端的做法是**把导航收进抽屉**：
 * - 页头只剩「品牌 + 汉堡」，高度恒为一行；
 * - 导航项改成纵向大热区列表（每项 ≥48px，符合触控目标尺寸建议）；
 * - 主题 / 语言这类低频操作移到抽屉底部，不占首屏。
 *
 * 无障碍：`role="dialog"` + `aria-modal`、打开时焦点移入、Esc 关闭、
 * 关闭后焦点还给汉堡按钮、打开时锁滚动、路由变化自动关闭。
 */

const { m, locale } = useI18n()
const route = useRoute()

/** 由父组件 `v-model:open` 控制，便于汉堡按钮与遮罩联动。 */
const open = defineModel<boolean>('open', { default: false })

const panel = ref<HTMLElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)

/**
 * 当前页高亮。
 *
 * 与 `SiteNav` 同一套规则（先剥 base 再比），否则子路径部署下永不命中。
 * 这里只做首页精确匹配 + 目录前缀匹配，和桌面导航保持一致。
 */
function isActive(link: string): boolean {
  const path = stripRouteBase(route.path)
  if (link === `/${locale.value}/`) return path === link
  const normalized = link.endsWith('/') ? link : `${link}/`
  return path === normalized || path.startsWith(normalized)
}

/** 打开前记录焦点，关闭时还回去（读屏用户不会丢失位置）。 */
let previousFocus: HTMLElement | null = null

function close(): void {
  open.value = false
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.preventDefault()
  close()
}

watch(open, (isOpen) => {
  if (typeof document === 'undefined') return

  if (isOpen) {
    previousFocus = document.activeElement as HTMLElement | null
    // 锁滚动：抽屉打开时背景不该跟着滚
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKeydown)
    // 等 DOM 渲染完再移焦点，否则元素还不存在
    requestAnimationFrame(() => closeButton.value?.focus())
  } else {
    document.body.style.overflow = ''
    document.removeEventListener('keydown', onKeydown)
    previousFocus?.focus()
    previousFocus = null
  }
})

// 客户端路由跳转后自动收起：否则点击导航项会留下一个盖住的抽屉
watch(
  () => route.path,
  () => {
    if (open.value) close()
  },
)

onBeforeUnmount(() => {
  if (typeof document === 'undefined') return
  document.body.style.overflow = ''
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <!--
    必须 Teleport 到 body，不能直接挂在 `.site-header` 里。
    原因：`.site-header` 用了 `backdrop-filter`（毛玻璃），而 backdrop-filter
    会**为 position: fixed 的后代创建包含块** —— 抽屉会以页头（约 56px）为
    定位参照，`inset: 0` 只能铺满页头那条窄缝，正文被裁掉。
    这是 CSS Containment 的已知行为，不是 flex/height 的问题。
  -->
  <Teleport to="body">
    <div v-if="open" class="m-nav" role="dialog" aria-modal="true" :aria-label="m.menuTitle">
      <!-- 遮罩：点击关闭。用 button 而不是 div，键盘也能触发 -->
      <button class="m-nav__scrim" type="button" :aria-label="m.closeMenu" @click="close" />

      <nav ref="panel" class="m-nav__panel">
        <header class="m-nav__head">
          <span class="m-nav__brand">{{ SITE.name }}</span>
          <button
            ref="closeButton"
            class="m-nav__close"
            type="button"
            :aria-label="m.closeMenu"
            @click="close">
            <AppIcon name="close" />
          </button>
        </header>

        <ul class="m-nav__list">
          <li v-for="item in NAV[locale]" :key="item.link">
            <a
              class="m-nav__link"
              :href="href(item.link)"
              :aria-current="isActive(item.link) ? 'page' : undefined">
              {{ item.text }}
              <AppIcon name="arrow-right" />
            </a>
          </li>
        </ul>

        <footer class="m-nav__tools">
          <span class="m-nav__tools-label">{{ m.switchLanguage }}</span>
          <div class="m-nav__tools-row">
            <ThemeToggle />
            <LocaleSwitch />
          </div>
        </footer>
      </nav>
    </div>
  </Teleport>
</template>
