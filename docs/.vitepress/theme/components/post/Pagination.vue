<script setup lang="ts">
/**
 * 分页组件。
 *
 * 纯展示：页码、上一页、下一页都由调用方算好传进来，
 * 因此「第几页 → 哪个地址」的规则只存在于 `support/paths.ts` 一处。
 */
import { computed } from 'vue'

import { useI18n } from '../../i18n'

const props = defineProps<{
  /** 当前页码（从 1 开始）。 */
  current: number
  /** 总页数。 */
  total: number
  /** 由页码得到地址。 */
  urlOf: (page: number) => string
}>()

const { m } = useI18n()

/** 页码列表；页数很多时用省略号折叠，避免撑爆一行。 */
const pages = computed<(number | '…')[]>(() => {
  const total = props.total
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1)

  const current = props.current
  const window = new Set<number>([1, total, current - 1, current, current + 1])
  const sorted = [...window].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b)

  const result: (number | '…')[] = []
  for (const [index, page] of sorted.entries()) {
    const previous = sorted[index - 1]
    if (previous !== undefined && page - previous > 1) result.push('…')
    result.push(page)
  }
  return result
})

const hasPrevious = computed(() => props.current > 1)
const hasNext = computed(() => props.current < props.total)
</script>

<template>
  <nav v-if="total > 1" :aria-label="m.pagination">
    <ul class="pagination">
      <li>
        <a
          v-if="hasPrevious"
          :href="urlOf(current - 1)"
          rel="prev"
          :aria-label="m.previousPage"
        >
          ←
        </a>
        <span v-else class="is-disabled" aria-hidden="true">←</span>
      </li>

      <li v-for="(page, index) in pages" :key="`${page}-${index}`">
        <span v-if="page === '…'" class="is-disabled" aria-hidden="true">…</span>
        <span v-else-if="page === current" class="is-current" aria-current="page">{{ page }}</span>
        <a v-else :href="urlOf(page)">{{ page }}</a>
      </li>

      <li>
        <a v-if="hasNext" :href="urlOf(current + 1)" rel="next" :aria-label="m.nextPage">→</a>
        <span v-else class="is-disabled" aria-hidden="true">→</span>
      </li>
    </ul>
  </nav>
</template>
