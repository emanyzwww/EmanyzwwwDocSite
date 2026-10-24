/**
 * 北京时间（站点时区）的日期计算。
 *
 * `pnpm new` 要求的「以中国北京时间为准」有两个容易做错的点：
 *
 * 1. **不能用 `new Date().getFullYear()` 那一套。** 那些方法按**运行机器的本地时区**
 *    取值。这台机器上是对的，CI（UTC）与别人机器上就可能差一天，
 *    于是同一时刻在不同机器上生成出 `2026/10/24` 与 `2026/10/23` 两种目录。
 * 2. **不能在零点附近用 UTC。** 北京时间 10-24 07:30 是 UTC 10-23 23:30，
 *    取 UTC 日期会差一天。
 *
 * 因此这里统一用 `Intl` + 站点时区做换算，并输出显式的 `+08:00` 偏移，
 * 保证「目录名里的日期」与「frontmatter 里的 date」永远是同一个时刻的两种写法。
 */

/** 拆分后的日期时间（全部是站点时区下的字面值）。 */
export interface ZonedParts {
  /** 四位年份。 */
  year: string
  /** 两位月份 `01`–`12`。 */
  month: string
  /** 两位日期 `01`–`31`。 */
  day: string
  /** 两位小时 `00`–`23`。 */
  hour: string
  /** 两位分钟。 */
  minute: string
  /** 两位秒。 */
  second: string
}

/** 仅日期部分。 */
export interface DateParts {
  year: string
  month: string
  day: string
}

/**
 * 按指定时区拆分一个时刻。
 *
 * `hourCycle: 'h23'` 是必要的：默认的 `h24` 会在大半夜给出 `24` 时，
 * 拼进 ISO 串就变成非法时间。
 */
export function splitZoned(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)

  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? ''

  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: pick('hour'),
    minute: pick('minute'),
    second: pick('second'),
  }
}

/**
 * 该时刻在指定时区的 UTC 偏移，形如 `+08:00`。
 *
 * 用 `longOffset` 而不是写死 `+08:00`：站点时区将来若改成别的地区，
 * `pnpm new` 生成的 `date` 会自动跟着正确，不需要再找一遍硬编码。
 */
export function zonedOffset(date: Date, timeZone: string): string {
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')?.value

  // `GMT+08:00` → `+08:00`；`GMT`（即 UTC 本身）→ `+00:00`
  const matched = /GMT([+-]\d{2}:\d{2})?/.exec(label ?? '')
  return matched?.[1] ?? '+00:00'
}

/** 当前时刻在站点时区下的日期时间。 */
export function nowInZone(timeZone: string, now: Date = new Date()): ZonedParts {
  return splitZoned(now, timeZone)
}

/** 某时刻在站点时区下的日期部分。 */
export function datePartsInZone(date: Date, timeZone: string): DateParts {
  const { year, month, day } = splitZoned(date, timeZone)
  return { year, month, day }
}

/**
 * 生成 frontmatter 的 `date` 值：`2026-10-24T22:49:28+08:00`。
 *
 * 带显式偏移，而不是 `2026-10-24` 这种裸日期：`WRITING.md` 明确推荐完整格式，
 * 裸日期会被不同构建机按不同时区解读，可能整体差一天。
 */
export function formatZonedIso(date: Date, timeZone: string): string {
  const { year, month, day, hour, minute, second } = splitZoned(date, timeZone)
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${zonedOffset(date, timeZone)}`
}

/** `2026` + `10` + `24` → `20261024`（`pnpm posts 20261024` 的过滤格式）。 */
export function toCompactDate(parts: DateParts): string {
  return `${parts.year}${parts.month}${parts.day}`
}

/** 目录路径的三段 → `20261024`。 */
export function pathToCompactDate(year: string, month: string, day: string): string {
  return `${year}${month}${day}`
}

/**
 * 解析 `20261024` 形式的日期。
 *
 * 严格校验长度与取值范围：`20261332` 这种「位数对但不存在的日期」必须报错，
 * 而不是被 `new Date()` 悄悄滚动成次年 1 月。
 */
export function parseCompactDate(value: string): DateParts {
  if (!/^\d{8}$/.test(value)) {
    throw new Error(`日期格式应为 8 位数字 YYYYMMDD，例如 20261024，收到：${value}`)
  }

  const year = value.slice(0, 4)
  const month = value.slice(4, 6)
  const day = value.slice(6, 8)

  const monthNumber = Number(month)
  const dayNumber = Number(day)
  if (monthNumber < 1 || monthNumber > 12) {
    throw new Error(`月份不合法：${value}（01–12）`)
  }

  // 用 UTC 日期做「这个月到底有几天」的判定，不受运行机时区影响
  const maxDay = new Date(Date.UTC(Number(year), monthNumber, 0)).getUTCDate()
  if (dayNumber < 1 || dayNumber > maxDay) {
    throw new Error(`日期不合法：${value}（${year} 年 ${month} 月只有 ${maxDay} 天）`)
  }

  return { year, month, day }
}

/** `2026` `10` `24` → `2026-10-24`，用于展示。 */
export function formatReadableDate(parts: DateParts): string {
  return `${parts.year}-${parts.month}-${parts.day}`
}

/** `2026-10-24T...` → `2026-10-24`，截取即用（前提是该串已按站点时区生成）。 */
export function isoDatePart(iso: string): string {
  return iso.slice(0, 10)
}

/**
 * 某时刻在**站点时区**下的 `YYYY-MM-DD`。
 *
 * 不能用 `date.toISOString().slice(0, 10)`：那是 **UTC** 日期。
 * 北京时间 `2026-10-19 04:09` 的 ISO 串是 `2026-10-18T20:09Z`，
 * 截取会得到 `10-18` —— 实测 `pnpm posts` 就把文章显示成了前一天。
 * 这与 `.vitepress/support/format.ts` 里 `formatRfc822` 踩过的是同一个坑。
 */
export function isoDateInZone(date: Date, timeZone: string): string {
  const { year, month, day } = splitZoned(date, timeZone)
  return `${year}-${month}-${day}`
}

/**
 * 把 ISO 串压回紧凑日期。
 *
 * 用于「frontmatter 的 date」与「目录名里的日期」做一致性校验：
 * 两者都来自同一个时刻，因此截取前 10 位、去掉连字符即可比较，
 * 不需要再做一次时区换算（`formatZonedIso` 输出的日期部分已经是站点时区的）。
 */
export function isoToCompactDate(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, '')
}

/** 从 ISO 串取出 `YYYY-MM-DD`。 */
export function isoToDashedDate(iso: string): string {
  return iso.slice(0, 10)
}
