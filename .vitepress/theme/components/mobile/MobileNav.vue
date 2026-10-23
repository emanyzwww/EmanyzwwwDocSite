<script setup lang="ts">
import { useRoute } from 'vitepress'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { data as profile } from '../../../data/profile.data'
import { NAV, SITE } from '../../../data/site'
import { useI18n } from '../../i18n'
import { resolveMedia } from '../../support/media'
import { acquireScrollLock, releaseScrollLock, trapFocus } from '../../support/overlay'
import { feedPath, href, isExternal, stripRouteBase } from '../../support/paths'
import AppIcon from '../common/AppIcon.vue'
import LocaleSwitch from '../site/LocaleSwitch.vue'
import ThemeToggle from '../site/ThemeToggle.vue'

/**
 * 移动端导航抽屉。
 *
 * **为什么不复用桌面页头**：桌面把「品牌 + 4 个导航项 + 搜索 + 主题 + 语言」
 * 压在一行里，靠水平排布降低视觉重量。窄屏照搬的结果是换行成两行、
 * 页头高度翻倍（实测 65px → 150px），既挤占首屏，又把
 * `--header-height` 这个布局契约顶破（进度条被盖住、锚点跳转被遮挡）。
 *
 * ---------- 三段式布局（本次重写的核心） ----------
 *
 * | 段   | 内容                | 滚动行为           |
 * |------|---------------------|--------------------|
 * | 顶部 | 品牌 + 关闭 + 工具区 | flex-shrink: 0（固定） |
 * | 中部 | 导航列表             | flex: 1 + overflow-y: auto（唯一可滚区） |
 * | 底部 | 精简资料条           | flex-shrink: 0（固定） |
 *
 * 旧实现把「主题 / 语言」放在 `margin-top: auto` 的底部工具区，
 * 面板又是整体 `overflow-y: auto` —— 只要导航项稍多，工具区就被推到
 * 视口之外，用户必须**手动滚动才能点到语言切换**。这正是报告里的 2-6。
 *
 * 而且旧的语言切换是**下拉菜单**（`position: absolute`），
 * 在 `overflow-y: auto` 的祖先里会被直接裁掉 —— 即使滚到了位置也弹不出来。
 * 所以在抽屉里改用**分段按钮**（简体中文 / English 并排，当前项高亮），
 * 一次点击完成切换，既没有裁剪问题，也少一次交互。
 *
 * ---------- 宽度固定 ----------
 *
 * `width: 19rem` + `max-width: calc(100vw - 4rem)`：
 * 固定宽度保证内部布局在任何机型上都不塌（旧值是 `min(84vw, 20rem)`，
 * 会随视口连续变化，行高与换行点跟着漂）；`max-width` 只是兜底，
 * 保证小屏上右侧仍露出足够的遮罩区域可以点击关闭。
 */

const { m, locale } = useI18n()
const route = useRoute()

/** 由父组件 `v-model:open` 控制，便于汉堡按钮与遮罩联动。 */
const open = defineModel<boolean>('open', { default: false })

/** 抽屉面板本体（焦点陷阱的边界）。 */
const panel = ref<HTMLElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)

/** 头像地址（与侧栏资料卡同源）。 */
const avatar = computed(() => resolveMedia(profile.avatar))
const displayName = computed(() => profile.name || SITE.name)

/** 社交链接：RSS 占位值替换成当前语言的 feed。 */
function resolveLink(url: string): string {
  return href(url === '/index.xml' ? feedPath(locale.value) : url)
}

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
/** 焦点陷阱的清理函数。 */
let releaseTrap: (() => void) | null = null

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
    /*
     * 锁滚动用引用计数，不能直接写 `body.style.overflow`：
     * 搜索面板也持有同一把锁，两处各自写会互相清掉（见 support/overlay.ts）。
     */
    acquireScrollLock()
    document.addEventListener('keydown', onKeydown)
    // Tab 不能跑出抽屉：aria-modal 只是声明，浏览器不会真的拦住
    releaseTrap = trapFocus(() => panel.value)
    // 等 DOM 渲染完再移焦点，否则元素还不存在
    requestAnimationFrame(() => closeButton.value?.focus())
  } else {
    releaseScrollLock()
    document.removeEventListener('keydown', onKeydown)
    releaseTrap?.()
    releaseTrap = null
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
  /*
   * 必须释放锁：抽屉可能因为路由跳转被直接销毁（`v-if` 跟随 `open`），
   * 那样 `watch` 的 else 分支不一定会跑到，锁会永久残留 → 页面再也滚不动。
   * `releaseScrollLock` 内部有「计数不小于 0」的保护，重复调用是安全的。
   */
  releaseScrollLock()
  releaseTrap?.()
  releaseTrap = null
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

      <nav ref="panel" class="m-nav__panel" :aria-label="m.drawerNav">
        <!-- ① 顶部：品牌 + 关闭（固定，不随内容滚动） -->
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

        <!--
          ② 工具区：主题 + 语言。
          放在顶部而不是底部，因为它必须**永远可见**——
          这是旧实现要求用户滚动才能点语言切换的直接原因。
        -->
        <div class="m-nav__tools">
          <ThemeToggle />
          <LocaleSwitch variant="segmented" />
        </div>

        <!--
          ③ 中部：导航（唯一可滚动区域）。

          `.m-nav__panel` 本身就是 `<nav>`，这里是它内部的列表，
          不再额外加 `aria-label`：`<ul>` 不是地标，加了也不产生新地标；
          而旧实现在 dialog 的 `aria-label="导航"` 与内层 `<nav aria-label="导航">`
          上写了同名标签，读屏的「地标列表」里会出现两条一模一样的条目。
        -->
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

        <!--
          ④ 底部：精简资料条（固定贴底，不随滚动）。

          用户明确要求：资料卡可以存在于抽屉里，但**不要在抽屉里堆那些卡片**。
          所以这里不是 `.profile` 那张大卡（头像 80px + 简介 + 大按钮），
          而是一行：小头像 + 名字 + 社交图标。信息密度与视觉重量都低得多，
          同时保留了「我是谁 / 去哪找我」这一项真实需求。
        -->
        <footer class="m-nav__profile">
          <div v-if="avatar" class="m-nav__avatar">
            <img :src="avatar" :alt="displayName" width="36" height="36" decoding="async" />
          </div>

          <div class="m-nav__who">
            <span class="m-nav__name">{{ displayName }}</span>
            <span v-if="profile.tagline" class="m-nav__tagline">{{ profile.tagline }}</span>
          </div>

          <ul v-if="profile.links.length" class="m-nav__social">
            <li v-for="link in profile.links" :key="link.url">
              <a
                :href="resolveLink(link.url)"
                :title="link.label"
                :aria-label="link.label"
                :target="isExternal(link.url) ? '_blank' : undefined"
                :rel="isExternal(link.url) ? 'noopener noreferrer' : undefined">
                <AppIcon :name="link.icon ?? 'link'" />
              </a>
            </li>
          </ul>
        </footer>
      </nav>
    </div>
  </Teleport>
</template>
