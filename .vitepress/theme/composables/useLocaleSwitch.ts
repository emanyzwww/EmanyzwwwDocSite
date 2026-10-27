/**
 * 语言切换。
 *
 * 规则（比旧站更明确）：
 * 0. 当前页是**文章**且有跨语言配对键 → 按键直达目标语言的同一篇文章
 *    （两边的 slug 各自本地化，路径永远不会同名）；
 * 1. 目标语言存在**完全对应**的页面 → 直达（`pages/` 下的页面两边同名）；
 * 2. 文章在目标语言没有翻译 → 退到目标语言的**文章列表页**
 *    （文章已经没有独立的“分区索引”，列表页就是它的栏目入口）；
 * 3. 其它页面退回**同栏目索引**（如 `/pages/tags/随笔/` → `/pages/tags/`）；
 * 4. 再不行退回目标语言的**首页**。
 *
 * 「页面是否存在」由构建期生成的 `pages.data.ts` 决定，不做字符串猜测；
 * 「文章配对」由 `posts.data.ts` 的 `translationKey` 决定（见 `support/translation.ts`）。
 * 两种语言地位对等，都是 `/zh-cn/`、`/en/` 这样的前缀。
 */

import { useData, useRoute } from 'vitepress'
import { computed } from 'vue'

import { data as pages } from '../../data/pages.data'
import { data as posts } from '../../data/posts.data'
import { asLocale, LOCALE_CODES, LOCALES } from '../../data/site'
import { isArticleUrlPath } from '../../support/article-path'
import { buildTranslationIndex, translatedUrl } from '../../support/translation'
import type { LocaleCode } from '../../types'
import { postListPath, stripLocale, stripRouteBase, withLocale } from '../support/paths'

export interface LocaleOption {
  code: LocaleCode
  label: string
  lang: string
  url: string
  current: boolean
}

/** 页面存在性索引（存的是编码后的 URL，与 `RawDoc.url` 一致）。 */
const knownPages = new Set(pages.urls)

/** 跨语言配对索引：配对键 → 语言 → 文章地址。`posts.data.ts` 构建期已算好键。 */
const translationIndex = buildTranslationIndex(posts)

/**
 * 由「剥掉语言前缀的裸路径」反查配对键。
 *
 * `resolveTarget` 拿到的是 `/202610/1901/hello-world/` 这样的裸路径，
 * 而 `PostSummary.url` 是 `/en/202610/1901/hello-world/`（含语言前缀、已编码），
 * 所以这里先 `stripLocale` 再作键。裸路径可能未编码（SSG 原文）也可能已编码
 * （浏览器 `route.path`），统一 `encodeURI` 归一化——对已编码串是恒等变换。
 */
const translationKeyByUrl = new Map<string, string>()
for (const [key, urls] of translationIndex) {
  for (const url of Object.values(urls)) translationKeyByUrl.set(encodeURI(stripLocale(url)), key)
}

export function useLocaleSwitch() {
  const route = useRoute()
  const { localeIndex } = useData()

  const current = computed<LocaleCode>(() => asLocale(localeIndex.value))

  /** 任意语言的入口列表（含当前语言，供下拉菜单渲染）。 */
  const options = computed<LocaleOption[]>(() => {
    /*
     * 两步剥离，顺序不能反：
     * 1. `stripRouteBase` 去掉部署 base（`/repo/zh-cn/pages/about/` → `/zh-cn/pages/about/`）。
     *    `route.path` 是**含 base** 的，而 `knownPages` 里全是**不含 base** 的
     *    站点路径，不减这一步的话下面几级回退会全部失配、永远落到语言首页。
     * 2. `stripLocale` 去掉语言前缀（`/zh-cn/pages/about/` → `/pages/about/`）。
     */
    const bare = stripLocale(stripRouteBase(route.path))

    return LOCALE_CODES.map((code) => {
      const meta = LOCALES[code]
      return {
        code,
        label: meta.label,
        lang: meta.lang,
        // 当前语言直接用 `route.path`（已含 base，可直接当 href）
        url: code === current.value ? route.path : resolveTarget(bare, code),
        current: code === current.value,
      }
    })
  })

  return { current, options }
}

/**
 * 按上面四条规则推导目标地址（0 → 1 → 2 → 3 → 4）。
 *
 * 比较时统一编码：`knownPages` / 配对索引存的是 `encodeURI` 后的形式，
 * 而 `route.path` 在浏览器里已经是编码后的（中文 slug 页会是 `%E4%BD%A0...`）。
 */
function resolveTarget(bare: string, locale: LocaleCode): string {
  // 0. 文章配对：按键直达目标语言的同一篇文章（两边 slug 不同也能配上）。
  //    `encodeURI` 把 SSG 的未编码原文与浏览器的已编码路径归一到同一形式。
  const byKey = translatedUrl(
    translationIndex,
    translationKeyByUrl.get(encodeURI(bare)) ?? null,
    locale,
  )
  if (byKey) return byKey

  // 1. 完全对应的页面（`pages/` 下的页面两边路径同名）
  const exact = withLocale(bare, locale)
  if (knownPages.has(exact)) return exact

  // 2. 文章没有翻译：退到目标语言的文章列表页（`/<locale>/pages/posts/`）
  if (isArticleUrlPath(bare)) return postListPath(locale)

  // 3. 同栏目索引：`pages/tags/随笔/` → `pages/tags/`
  const segments = bare.split('/').filter(Boolean)
  if (segments[0] === 'pages' && segments.length > 2) {
    const section = withLocale(`/${segments[0]}/${segments[1]}/`, locale)
    if (knownPages.has(section)) return section
  }

  // 4. 语言首页
  return withLocale('/', locale)
}
