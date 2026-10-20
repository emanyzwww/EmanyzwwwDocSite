/** 分页计算（纯函数，无框架依赖）。 */

export interface PageSlice<T> {
  /** 当前页的条目。 */
  items: T[]
  /** 当前页码（已夹到合法范围）。 */
  current: number
  /** 总页数（至少为 1）。 */
  totalPages: number
}

/**
 * 取第 `page` 页的数据。
 * 页码越界时自动夹到 `[1, totalPages]`，因此 `page/99/` 这类地址仍有内容可看。
 */
export function paginate<T>(items: T[], page: number, perPage: number): PageSlice<T> {
  const size = Math.max(1, Math.trunc(perPage))
  const totalPages = Math.max(1, Math.ceil(items.length / size))
  const current = Math.min(Math.max(1, Math.trunc(page) || 1), totalPages)
  const start = (current - 1) * size

  return { items: items.slice(start, start + size), current, totalPages }
}

/** 总页数（用于构建期生成分页路由）。 */
export function pageCount(totalItems: number, perPage: number): number {
  return Math.max(1, Math.ceil(totalItems / Math.max(1, Math.trunc(perPage))))
}
