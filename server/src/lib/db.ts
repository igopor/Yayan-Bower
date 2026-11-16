import { PrismaClient } from '@prisma/client'

/**
 * Prisma 单例。开发期热重载会重复实例化，这里挂到 globalThis 上避免连接数暴涨。
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

function createClient() {
  const client = new PrismaClient({
    // 用事件方式接日志，而不是直接打到 stdout —— 这样才能按内容过滤
    log: [
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
    ],
  })

  client.$on('error', (e) => {
    /**
     * 唯一约束冲突是**预期结果**，不是故障：
     * 积分发放靠 `(user_id, biz_type, biz_id)` 唯一索引做幂等，
     * 学生连点两下收藏时，第二个请求必然撞上它，然后被正常处理成"重复，不加分"。
     * 这条日志如果不滤掉，每次连点都会刷一条 error，真正的问题会被淹没。
     */
    if (e.message.includes('Unique constraint failed')) return
    console.error('[prisma:error]', e.message)
  })

  client.$on('warn', (e) => {
    console.warn('[prisma:warn]', e.message)
  })

  return client
}

export const prisma = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
