/**
 * 移动端「阅读态」状态机。
 *
 * 手机会话里其实只有两种姿势，本站按它们切换整套 chrome：
 *
 * | 状态      | 页头 | 底部胶囊        | 用户在哪   |
 * |-----------|------|-----------------|------------|
 * | `rest`    | 显示 | 展开成横向胶囊  | 刚进页面 / 正在找东西 / 往上翻 |
 * | `reading` | 隐藏 | 收成右侧小圆    | 正在往下读长文 |
 *
 * 为什么「阅读态」要连页头一起隐藏：
 * 手机上垂直空间是唯一稀缺资源。页头 57px + 胶囊 52px ≈ 一屏的 1/8，
 * 长文阅读时它们只是纯装饰（用户不找导航、不看品牌），
 * 隐藏后正文有效行数明显增加。而往回滚一点就能立刻拿回来，
 * 所以这是「零代价的隐身」，不是「藏起来找不到」。
 *
 * =========================================================
 * 判定逻辑（这一版重写过，别再退回旧写法）
 * =========================================================
 *
 * 第一版的问题：`EXIT_DELTA = 6`（上滚 6px 就恢复）+ `touchmove` 手指上移
 * 12px 就恢复。结果是一次滚动手势里状态能来回翻好几次 ——
 * 手指刚放上去稍微一抖就展开、继续滚又收回，观感是「抽搐」。
 *
 * 现在用三条机制，缺一不可：
 *
 * 1. **对称滞回**：进入与退出各需累计 `THRESHOLD`（60px），不是「一个
 *    小反向就恢复」。方向一反转，反向累加器立即归零 —— 也就是说必须
 *    **持续**朝同一方向滑够 60px 才切换，这正是「看接下来的动作行为」，
 *    而不是「瞄一眼就下结论」。
 *
 * 2. **冷却期**：一次切换后 `COOLDOWN` 毫秒内不再切换。滚动惯性衰减时
 *    的微小抖动、以及在惯性中触碰屏幕造成的滚动停止，都会被这条吃掉。
 *
 * 3. **程序化滚动抑制**：`resetDock()` 之后的 `HOLD_MS` 内强制 `rest`。
 *    点目录跳转用 `scroll-behavior: smooth`，动画期间持续产生向下滚动
 *    事件 —— 不抑制的话「点目录跳到下一节」会在动画结束后变成隐藏态
 *    （用户反馈的现象：向上跳展开、向下跳隐藏）。
 *
 * 只在**滚动**上判定，不再挂 `touchstart` / `touchmove`：
 * 触摸本身不携带意图，滚动位移才携带。旧实现把手势当信号，
 * 必然出现「手指刚放上去就展开」。
 *
 * ---------- 为什么是模块级单例 ----------
 *
 * `SiteHeader` 与 `MobileDock` 必须看到**同一个**状态。如果每处各建一份，
 * 就会各自注册滚动监听、各自算一遍，极容易算出两个不同结论
 * （典型的 bug：页头藏了、胶囊没缩，或者反过来）。
 */

import { readonly, ref } from 'vue'

/** 顶部保护带：小于这个滚动量永远保持 rest。 */
const TOP_GUARD = 160
/** 进入 / 退出阅读态各需的累计滚动距离（**对称**，不要单边调小）。 */
const THRESHOLD = 60
/** 一次切换后的静默期，吃掉惯性与抖动造成的来回翻转。 */
const COOLDOWN = 420
/**
 * 「等滚动停稳」模式的空闲判定：最后一次滚动后静默这么久就算停稳。
 *
 * 取值要比惯性帧间隔（约 16ms）大得多、又远小于读者能察觉的时间
 * （100ms 内不感知）。140ms 能稳定吃掉末端的零星事件。
 */
const SETTLE_IDLE_MS = 140
/**
 * 「等滚动停稳」的硬上限。
 *
 * 只靠空闲判定有一个风险：读者在程序化滚动刚结束时就接手继续滑，
 * 于是"停稳"永远等不到，chrome 会一直保持展开。
 * 这不是灾难（展开本来也是默认态），但会让"向下读时自动收起"
 * 这个功能短时间失效。给一个上限做兜底，2 秒后无论如何恢复判定。
 */
const SETTLE_MAX_MS = 2000

export type DockMode = 'rest' | 'reading'

const mode = ref<DockMode>('rest')
/** 是否已经滚过半屏（决定「回到顶部」是否可用）。 */
const scrolled = ref(false)

let lastY = 0
/** 向下 / 向上两个独立累加器：方向反转即清零，保证「持续」而不是「净位移」。 */
let downAccum = 0
let upAccum = 0
let listening = false
let frame = 0
/** 冷却期截止时间戳。 */
let cooldownUntil = 0
/** 强制 rest 的截止时间戳（程序化滚动的硬上限兜底）。 */
let holdUntil = 0
/** 最近一次观察到滚动的时间戳（用于「等停稳」判定）。 */
let lastScrollAt = 0
/** 是否处于「程序化滚动，等它停稳」模式。 */
let settling = false
/**
 * 抑制期间是否已经观察到实际位移。
 *
 * 见 `update()` 里 `started` 的注释：`reset()` 之后到真正开始滚动之间
 * 有一段空白（关浮层、等滚动锁释放），不能把这段算进"停稳"。
 */
let started = false

/** 是否贴底（留 2px 容差，与 `useActiveAnchor` 同一口径）。 */
function atBottom(): boolean {
  const doc = document.documentElement
  return window.innerHeight + window.scrollY >= doc.scrollHeight - 2
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function switchTo(next: DockMode): void {
  mode.value = next
  cooldownUntil = now() + COOLDOWN
  downAccum = 0
  upAccum = 0
}

function update(): void {
  const y = window.scrollY
  const delta = y - lastY
  const t = now()

  scrolled.value = y > window.innerHeight * 0.5

  /*
   * ---------- 程序化滚动期间的抑制 ----------
   *
   * 这是「点目录跳转后 chrome 有概率收起」的根治。
   *
   * 平滑滚动持续多久**不是固定的**：它由浏览器按距离与曲线计算，
   * 本站长文里跨章节跳转实测约 750ms，而且必须叠加「等锁定释放」
   * （iOS 上 body 解除固定后才开始动）——所以总量远超一个写死的 700ms。
   * 旧实现用固定 `HOLD_MS = 700`，越过它的那一段滚动就被当成
   * 读者主动下滚，于是判定进 `reading`、chrome 收起。
   *
   * 现在改成**等滚动真正停稳**（连续 `SETTLE_IDLE_MS` 无滚动事件），
   * 并保留 `SETTLE_MAX_MS` 硬上限兜底。这样不管平滑滚动多长、
   * 中间穿插几次异步解锁，都不会误判。
   */
  if (settling) {
    /*
     * 判定「停稳」：距最后一次**位置变化**已经静默 `SETTLE_IDLE_MS`。
     * 用 `lastScrollAt`（只在 delta ≠ 0 时刷新）而不是每帧都刷 ——
     * 否则滚动结束后的零星事件会无限延长。
     *
     * ⚠️ `started` 这一条是必须的，别删。
     *
     * `reset()` 被调用时页面往往**还没开始动**（点目录 → 关浮层 → 等解锁
     * → 才开始平滑滚动）。如果此时直接把 `lastScrollAt` 当基准，
     * 那么第一次 scroll 事件到来时可能已经过去 >140ms（等解锁、等 rAF），
     * `idled` 立刻成立 → 抑制**刚进入就退出** → 后面的滚动全部被当成
     * 读者主动下滚 → chrome 收起。
     *
     * 所以要求「先见到位移，再谈停稳」：`started` 由第一帧 delta ≠ 0 置位。
     */
    /*
     * `capped` 只看总时长，**不加 `started`**：万一目标就在原地
     * （点了当前章节、或页面在顶部跳顶部），永远不会有位移，
     * 抑制必须靠时间自己退出，否则"向下读时自动收起"会永久失效。
     */
    const idled = started && t - lastScrollAt >= SETTLE_IDLE_MS
    const capped = t >= holdUntil

    if (!idled && !capped) {
      if (mode.value !== 'rest') switchTo('rest')
      downAccum = 0
      upAccum = 0
      lastY = y
      if (delta !== 0) {
        started = true
        lastScrollAt = t
      }
      return
    }

    /*
     * 停稳（或到达硬上限）：退出抑制模式。
     *
     * 这里**必须 return**，把这一帧当作"静止的一帧"处理掉 ——
     * 它的 `delta` 属于程序化滚动的收尾，不属于读者的输入。
     *
     * ⚠️ **不要**在这里设置 `cooldownUntil`。
     * 停稳之后读者的第一次下滚是正常输入，它应当立刻开始累加；
     * 若给一个 420ms 冷却，"停稳 → 读者马上接着下滚"这个序列
     * （真实手机上很容易发生：跳到目标后顺势往下滑）会被冷却期吃掉，
     * 表现为 chrome 迟迟不收起 —— 又是"有概率收起来"的另一种表现。
     * 冷却期的本意是吃掉惯性衰减期的抖动，而"停稳"判定本身
     * 已经把抖动隔离在抑制期里了。
     *
     * `lastY` 对齐到当前位置，这样退出后的第一个真实 delta
     * 才不会包含程序化滚动最后那几十像素（否则会被计入读者累加，
     * 表现为"停稳瞬间莫名跳进 reading"）。
     */
    settling = false
    started = false
    holdUntil = 0
    downAccum = 0
    upAccum = 0
    lastY = y
    return
  }

  // 顶部保护带：进页面、跳转后回顶都落在这里
  if (y <= TOP_GUARD) {
    if (mode.value !== 'rest') {
      // 回顶是「用户主动找东西」，不受冷却期约束，立刻展开
      mode.value = 'rest'
      cooldownUntil = 0
    }
    downAccum = 0
    upAccum = 0
    lastY = y
    return
  }

  const cooling = t < cooldownUntil

  if (delta > 0) {
    // 向下：累加；上滚累加器清零（方向反转 = 重新开始计数）
    downAccum += delta
    upAccum = 0
    if (!cooling && mode.value === 'rest' && downAccum >= THRESHOLD && !atBottom()) {
      switchTo('reading')
    }
  } else if (delta < 0) {
    upAccum += -delta
    downAccum = 0
    if (!cooling && mode.value === 'reading' && upAccum >= THRESHOLD) {
      switchTo('rest')
    }
  }

  lastY = y
}

/** rAF 合并：同一帧内多次滚动只算一次。 */
function schedule(): void {
  if (frame) return
  frame = window.requestAnimationFrame(() => {
    frame = 0
    update()
  })
}

/**
 * 读者主动接手的信号 —— 用来立刻结束「等停稳」抑制。
 *
 * ---------- 为什么必须有这个 ----------
 *
 * 「等停稳」的判定依赖"滚动事件静默 140ms"。但有一个漏洞：
 * 读者在跳转刚结束时**立刻接手继续滑**（顺势往下滑是极自然的动作），
 * 此时滚动事件持续到来 → `lastScrollAt` 一直被刷新 → "静默"永远等不到
 * → 抑制永不退出 → chrome 一直保持展开。
 *
 * 实测：跳转结束后持续下滚 1500px 都进不了 reading
 * （靠 `SETTLE_MAX_MS` 硬上限兜底才退出）。
 *
 * 解法是用**用户输入**作为接手信号：程序化滚动不会产生
 * `touchstart` / `wheel` / `keydown`，只有真人的手会。
 * 三者任一出现，抑制立即结束，状态机恢复正常判定。
 */
function onUserInput(): void {
  if (!settling) return
  settling = false
  started = false
  holdUntil = 0
  downAccum = 0
  upAccum = 0
  cooldownUntil = 0
  lastY = window.scrollY
}

let inputListening = false

function ensureInputListeners(): void {
  if (inputListening || typeof window === 'undefined') return
  inputListening = true
  const opts = { passive: true } as AddEventListenerOptions
  window.addEventListener('touchstart', onUserInput, opts)
  window.addEventListener('wheel', onUserInput, opts)
  window.addEventListener('keydown', onUserInput)
}

/**
 * 强制回到 rest，并进入「等滚动停稳」模式。
 *
 * 用于：路由切换、点击目录跳转、打开任意浮层、回到顶部。
 * 这些时刻用户正在「找东西」，chrome 必须立刻可见；
 * 且随后的平滑滚动不能把它重新判定成 reading —— 无论它滚多久。
 *
 * ---------- 为什么从「固定时长」改成「等停稳」 ----------
 *
 * 旧实现是 `holdUntil = now() + 700`，一个写死的窗口。问题是平滑滚动
 * 的时长**不受我们控制**：
 *
 * | 情况 | 平滑滚动耗时 |
 * |------|--------------|
 * | 桌面侧栏目录跳一小段 | ~250ms |
 * | 手机跨章节跳转 | ~750ms |
 * | iPhone 上再叠加解锁延迟（body 解除 fixed） | +150~220ms |
 *
 * 只要真实耗时超过 700ms，超出那段的滚动事件就会被当成「读者主动下滚」，
 * 于是判定进 reading、chrome 收起 —— 这正是用户报告的
 * 「点击跳转后 chrome 有概率收起」（概率来自跳转距离与设备性能）。
 *
 * 现在改为：进入抑制后，持续观察滚动；连续 `SETTLE_IDLE_MS` 没有位移
 * 才认为停稳、交回判定权。`SETTLE_MAX_MS` 只是兜底上限。
 *
 * @param holdMs 硬上限（默认 2s）。仅用于防止"读者立刻接手继续滑"
 *               导致抑制永不退出。**不要用它当"预计动画时长"**。
 */
export function resetDock(holdMs = SETTLE_MAX_MS): void {
  mode.value = 'rest'
  downAccum = 0
  upAccum = 0
  cooldownUntil = 0
  settling = true
  started = false
  lastScrollAt = now()
  holdUntil = lastScrollAt + holdMs
  if (typeof window !== 'undefined') lastY = window.scrollY
}

/**
 * 订阅阅读态。
 *
 * 可以放心地在多个组件里各调一次：状态与滚动监听都是模块级单例，
 * 第二次调用只是多读一个 `ref`，不会重复绑定事件。
 */
export function useDockState() {
  if (!listening && typeof window !== 'undefined') {
    listening = true
    lastY = window.scrollY
    window.addEventListener('scroll', schedule, { passive: true })
    ensureInputListeners()
    // 首次进入时算一遍：从上一页带着滚动位置过来时状态要对
    update()
  }

  return {
    /** 当前形态。 */
    mode: readonly(mode),
    /** 是否已滚过半屏。 */
    scrolled: readonly(scrolled),
    reset: resetDock,
  }
}

/**
 * 重置模块级状态 —— **仅供单测**。
 *
 * 与 `overlay.ts` 的 `resetOverlayStateForTests` 同一个理由：
 * `listening`（是否已注册滚动监听）是模块级单例。在 vitest 里，
 * 第一个用例调用 `useDockState()` 后它就永远是 true；后续用例若
 * 重新 stub 了 `window`，监听器注册会被 `listening` 短路 ——
 * 于是滚动事件再也派发不进状态机，表现为「怎么滚都是 rest」。
 *
 * 浏览器里不要调用：那会导致重复注册滚动监听。
 */
export function resetDockStateForTests(): void {
  listening = false
  inputListening = false
  frame = 0
  settling = false
  started = false
  holdUntil = 0
  cooldownUntil = 0
  downAccum = 0
  upAccum = 0
  mode.value = 'rest'
  scrolled.value = false
}
