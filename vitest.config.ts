import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(here, 'web/src'),
      '@shared': path.resolve(here, 'shared'),
    },
  },
  test: {
    include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'web/src/**/*.test.ts'],
    passWithNoTests: true,
    environment: 'node',
    /**
     * 串行跑测试文件。
     * 并行 worker 会各自往系统临时目录写缓存，在受限环境下会被 EPERM 挡住，
     * 表现为"某个测试文件静默不执行"。测试总量很小，串行的耗时差异可以忽略。
     */
    fileParallelism: false,
    // 测试不读 .env：把必需变量直接注入，保证在干净机器上也能跑
    env: {
      // 注意：Prisma 的相对路径是相对 schema.prisma 所在目录（server/prisma/）解析的，
      // 不是相对 cwd。写成 server/prisma/dev.db 会找不到文件。
      DATABASE_URL: 'file:./dev.db',
      JWT_SECRET: 'test-secret-do-not-use-in-prod',
      SMS_PROVIDER: 'mock',
      SMS_MOCK_CODE: '123456',
    },
  },
})
