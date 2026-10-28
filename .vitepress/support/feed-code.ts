/**
 * RSS 里的代码块清洗：把「网页专用」的交互结构压成阅读器能读的纯文本代码。
 *
 * ## 为什么需要它
 *
 * RSS 的 `content:encoded` 直接复用 VitePress 渲染好的正文（见 `support/rendered.ts`），
 * 好处是图片地址、标题锚点、语法高亮与网页完全一致；代价是**网页专用的零件**
 * 也跟着进了 feed：
 *
 * - `<button class="copy">`：复制按钮在阅读器里是一个没有文字的控件，纯噪音；
 * - `<span class="lang">` 与 `.code-block__label`：语言名 / 文件路径是给「常驻头部
 *   控件区」排版用的（见 `support/markdown/code-blocks.ts`），feed 里没有那段 CSS，
 *   它们只会变成堆在代码上方的一串散字；
 * - `::: code-group` 的 `.tabs`：radio + label 的切换交互，阅读器不执行 JS，
 *   结果是**所有**标签名排成一行，而下面还跟着所有面板的代码；
 * - `<div class="language-xxx">` 包装层、`tabindex`、`v-pre`、`class`：对阅读器无意义；
 * - `style="--shiki-light:…;--shiki-dark:…"`：这是给网页 `.dark` 切换用的自定义属性，
 *   阅读器不认识，属于死属性。
 *
 * 清洗目标很朴素：**代码块只剩 `<pre>` + 文本**，颜色交给阅读器自己的前景色。
 * 双主题下 Shiki 不写内联 `color`（VitePress 传 `defaultColor: false`），
 * 所以清掉这些变量不会让文字「变隐形」——这恰好是旧单主题方案在 feed 里
 * 最危险的地方（浅色字落在阅读器白底上）。
 *
 * ## 为什么用「扫描 + 深度计数」而不是正则一把梭
 *
 * `.tabs`、`.blocks` 与代码块包装层都可能套多层 `<div>`（代码组本身就有三层），
 * 非贪婪正则在第一个 `</div>` 就收手，会把正文切掉一半——`rendered.ts` 的
 * `extractProse()` 踩过同一个坑。这里按 `<div` / `</div>` 计数找到配对结尾，
 * 再决定「删掉整块」还是「只脱掉外壳」。
 *
 * ## 契约
 *
 * 输入是 VitePress 1.6.4 渲染后（并经过 Vue 序列化）的正文，
 * 真实结构见 `tests/feed-code.test.ts` 的 fixture。两条硬约束：
 *
 * 1. **没有代码块的 HTML 必须恒等输出**——不能因为「顺手清理」改到正文；
 * 2. **幂等**：`sanitizeFeedCode(sanitizeFeedCode(html)) === sanitizeFeedCode(html)`。
 *    RSS 生成过程可能被重复调用，清洗器不能越洗越花。
 */

/* ------------------------------------------------------------------ *
 * 一、扫描小工具
 * ------------------------------------------------------------------ */

/** `</div>` 的长度。脱壳时要按它从配对结尾回退。 */
const DIV_CLOSE = '</div>'

/**
 * 取开标签的 `class` 列表。
 *
 * 用 `(?:^|\s)` 锚定整个属性名，避免把 `data-class="…"` 误当 `class`。
 */
function classList(tag: string): string[] {
  const match = /(?:^|\s)class="([^"]*)"/.exec(tag)
  return match ? match[1].split(/\s+/).filter(Boolean) : []
}

/** 从 `from` 起找下一个 `<div`，返回开标签的起止位置；找不到返回 `null`。 */
function findDiv(html: string, from: number): { start: number; end: number } | null {
  // `(?=[\s>])` 是为了排除 `<divider`、`<dividend` 这类以 div 开头的标签
  const pattern = /<div(?=[\s>])/g
  pattern.lastIndex = from
  const match = pattern.exec(html)
  if (!match) return null

  const end = html.indexOf('>', match.index)
  return end === -1 ? null : { start: match.index, end: end + 1 }
}

/**
 * 与 `start` 处的 `<div` 配对的 `</div>` 之后的位置；结构不配平返回 `-1`。
 *
 * 只看 div：代码内容里的 `<` 已经被转义成 `&lt;` / `&#x3C;`，
 * 不会混进来干扰计数（这也是能安全用计数法的前提）。
 */
function matchingDivEnd(html: string, start: number): number {
  const pattern = /<div\b|<\/div>/g
  pattern.lastIndex = start
  let depth = 0

  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    if (match[0] === DIV_CLOSE) {
      depth -= 1
      if (depth === 0) return match.index + DIV_CLOSE.length
    } else {
      depth += 1
    }
  }

  return -1
}

/** `<div>` 及其配对结尾的位置。`openEnd` 是开标签之后，`end` 是 `</div>` 之后。 */
interface DivScope {
  start: number
  openEnd: number
  end: number
}

/** 按 class 名找第一个 `<div>`，返回它的作用范围。 */
function findDivByClass(html: string, name: string): DivScope | null {
  let cursor = 0

  for (;;) {
    const open = findDiv(html, cursor)
    if (!open) return null

    if (classList(html.slice(open.start, open.end)).includes(name)) {
      const end = matchingDivEnd(html, open.start)
      return end === -1 ? null : { start: open.start, openEnd: open.end, end }
    }

    cursor = open.start + 1
  }
}

/* ------------------------------------------------------------------ *
 * 二、通用的 div 处理：删掉整块 / 只脱外壳
 * ------------------------------------------------------------------ */

type DivAction = 'remove' | 'unwrap'

/**
 * 遍历 `<div>`，把 class 命中的元素按 `action` 处理。
 *
 * - `remove`：连同内容整块删除（`.tabs` 这种纯交互结构）；
 * - `unwrap`：只删开闭标签、保留内容（包装层这种纯排版结构）。
 *
 * 不命中的 div 原样保留，所以 `:::tip`、表格、嵌套布局都不会被误伤。
 */
function transformDivs(
  html: string,
  matches: (classes: string[]) => boolean,
  action: DivAction,
): string {
  // `cursor` 是「已输出到哪」，`scan` 是「下一个待检查的 `<div` 从哪找」。
  // 两者必须分开：跳过不命中的 div 只推进 scan，否则会漏掉它前面那段文本。
  let out = ''
  let cursor = 0
  let scan = 0

  for (;;) {
    const open = findDiv(html, scan)
    if (!open) break

    const tag = html.slice(open.start, open.end)
    if (!matches(classList(tag))) {
      // 不是目标 div：只跳过它的开标签，内部的嵌套 div 仍要检查
      scan = open.start + 1
      continue
    }

    const end = matchingDivEnd(html, open.start)
    if (end === -1) {
      // 结构不配平（被别的规则切断了）：别冒险，原样留下
      scan = open.start + 1
      continue
    }

    out += html.slice(cursor, open.start)
    if (action === 'unwrap') {
      // 内容里可能还有同类外壳（兜底路径下的嵌套），递归脱壳
      out += transformDivs(html.slice(open.end, end - DIV_CLOSE.length), matches, action)
    }
    cursor = end
    scan = end
  }

  out += html.slice(cursor)
  return out
}

/** 代码块包装层：VitePress 的 `language-*`，或本站注入的 `code-block`。 */
function isCodeWrapper(classes: string[]): boolean {
  return classes.some((token) => token === 'code-block' || token.startsWith('language-'))
}

/* ------------------------------------------------------------------ *
 * 三、逐条清洗
 * ------------------------------------------------------------------ */

/** `.code-block__label`：头部控件区的文件路径 / 语言名标签。 */
const CODE_LABEL_RE = /<span\b[^>]*class="[^"]*code-block__label[^"]*"[^>]*>[^<]*<\/span>/gi

/**
 * 路径标签 → 独立段落，其余标签直接删。
 *
 * 只有「作者写了 `[路径]`」的块才有 `data-file`（见 `code-blocks.ts`）；
 * 没有路径的块标签里只是语言名，而语言名对 feed 读者没有价值（代码内容
 * 本身已经说明是什么语言），所以删掉。
 *
 * `data-file` 的值在构建期已做过 HTML 转义（`escapeHtml`），这里直接复用，
 * 不能再用文本内容——否则路径里的 `&`、引号会被二次处理。
 */
function labelsToParagraphs(html: string): string {
  return html.replace(CODE_LABEL_RE, (label) => {
    const file = /\bdata-file="([^"]*)"/i.exec(label)?.[1]
    return file ? `<p><small>${file}</small></p>` : ''
  })
}

/** 代码分组的「当前可见面板」：`.tabs` 删掉，`.blocks` 里只留 `.active` 那块。 */
function activeCodeGroupPanel(inner: string): string {
  const blocks = findDivByClass(inner, 'blocks')
  // 没有 `.blocks` 时（结构异常）退化成在整个分组内容里找面板
  const region = blocks ? inner.slice(blocks.openEnd, blocks.end - DIV_CLOSE.length) : inner

  const panels: { markup: string; active: boolean }[] = []
  let scan = 0

  for (;;) {
    const open = findDiv(region, scan)
    if (!open) break

    const end = matchingDivEnd(region, open.start)
    if (end === -1) break

    const tag = region.slice(open.start, open.end)
    if (isCodeWrapper(classList(tag))) {
      panels.push({
        markup: region.slice(open.start, end),
        active: classList(tag).includes('active'),
      })
      scan = end
    } else {
      scan = open.start + 1
    }
  }

  /*
   * 没有 `.active` 是一种真实情况：代码分组里所有围栏都没写 `[标题]` 时，
   * VitePress 一个 tab 也不生成、也不标 active。此时保留第一块，
   * 至少读者还能看到代码，而不是一片空白。
   */
  const chosen = panels.find((panel) => panel.active) ?? panels[0]
  return chosen
    ? chosen.markup
    : transformDivs(inner, (classes) => classes.includes('tabs'), 'remove')
}

/** 处理所有 `::: code-group`：删掉 tab 交互，只留当前面板。 */
function sanitizeCodeGroups(html: string): string {
  let out = ''
  let cursor = 0
  let scan = 0

  for (;;) {
    const open = findDiv(html, scan)
    if (!open) break

    const tag = html.slice(open.start, open.end)
    if (!classList(tag).includes('vp-code-group')) {
      scan = open.start + 1
      continue
    }

    const end = matchingDivEnd(html, open.start)
    if (end === -1) {
      scan = open.start + 1
      continue
    }

    out += html.slice(cursor, open.start)
    out += activeCodeGroupPanel(html.slice(open.end, end - DIV_CLOSE.length))
    cursor = end
    scan = end
  }

  out += html.slice(cursor)
  return out
}

/** 复制按钮：`<button class="copy">`（VitePress 的复制逻辑完全在客户端，feed 里没意义）。 */
const COPY_BUTTON_RE = /<button\b[^>]*class="[^"]*\bcopy\b[^"]*"[^>]*>(?:<\/button>)?/gi

/** 语言标识 `<span class="lang">`。`\b` 保证不会误吃 `language-xxx`。 */
const LANG_SPAN_RE = /<span\b[^>]*class="[^"]*\blang\b[^"]*"[^>]*>[^<]*<\/span>/gi

/**
 * `<pre>` 的所有属性都去掉（`class="shiki …"`、`tabindex`、`v-pre`、`style`）。
 *
 * `v-pre` 是 Vue 的编译期指令——它在构建产物里其实已经被 Vue 消费掉，
 * 但单元测试直接喂 markdown-it 的原始输出时还在，两种输入都要能处理。
 */
const PRE_OPEN_RE = /<pre\b[^>]*>/gi

/**
 * Shiki 双主题写在 span 上的自定义属性。
 *
 * 值形如 `--shiki-light:#0F766E;--shiki-dark:#4ACDB4`。阅读器不认识它们，
 * 删掉后文字继承阅读器前景色，正好是 feed 想要的「纯文本代码块」。
 */
const SHIKI_STYLE_RE = / style="[^"]*--shiki-[^"]*"/gi

/**
 * 把网页版的代码块结构清洗成阅读器友好的纯文本代码。
 *
 * 对没有代码块的 HTML 是恒等变换（幂等，无副作用），可以无脑放进 RSS 生成链。
 *
 * @param html VitePress 渲染好的正文 HTML（`support/rendered.ts` 收集的那份）
 */
export function sanitizeFeedCode(html: string): string {
  // 1. 头部的文件路径 / 语言名标签：有路径的留成一小段，其余删掉
  let out = labelsToParagraphs(html)

  // 2. 代码分组：删掉 tabs（radio + label 交互），只保留当前可见面板
  out = sanitizeCodeGroups(out)

  // 3. 复制按钮与语言标识：纯网页控件，feed 里没有对应行为
  out = out.replace(COPY_BUTTON_RE, '').replace(LANG_SPAN_RE, '')

  // 4. 脱掉代码块包装层（`<div class="language-xxx">` / `code-block`），保留 pre
  out = transformDivs(out, isCodeWrapper, 'unwrap')

  /*
   * 5. 兜底：上面第 2 步只在结构完整时生效。如果代码分组的 div 被别的
   *    清洗规则切断过，这里至少把残留的交互外壳拿掉，别让 tabs 漏进 feed。
   */
  out = transformDivs(out, (classes) => classes.includes('tabs'), 'remove')
  out = transformDivs(
    out,
    (classes) => classes.includes('blocks') || classes.includes('vp-code-group'),
    'unwrap',
  )

  // 6. pre 只留标签名；span 的 shiki 变量是给网页明暗切换用的，阅读器用不到
  out = out.replace(PRE_OPEN_RE, '<pre>')
  out = out.replace(SHIKI_STYLE_RE, '')

  return out
}
