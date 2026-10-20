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
 *
 * 页码越界时夹到 `[1, totalPages]`，因此即使传进 `99` 也能拿到最后一页。
 *
 * 注意：这条兜底**不会**让 `/posts/page/99/` 变成可访问地址——
 * 分页路由由 `index.paths.ts` 只生成 `2..totalPages`，越界页码本身就是 404。
 * 这里的夹取只用于「页面已存在、但参数异常」的情况（例如手动改地址栏后
 * 客户端路由复用了同一个组件）。
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
