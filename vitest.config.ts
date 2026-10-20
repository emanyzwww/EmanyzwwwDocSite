import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 只跑 tests/ 下的用例，不碰 docs 里的内容
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // 构建期代码会读 globalThis.VITEPRESS_CONFIG，这里没有，走 process.cwd() 兜底
    reporters: 'default',
  },
})
