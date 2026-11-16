import { Router } from 'express'
import { prisma } from '../lib/db'
import { ok } from '../lib/http'

export const healthRouter = Router()

/**
 * GET /api/health
 * 返回进程与数据库状态。数据库打不开时返回 503，便于快速判断"是代码问题还是库问题"。
 */
healthRouter.get('/health', async (_req, res) => {
  const started = Date.now()
  try {
    await prisma.$queryRaw`SELECT 1`
    return ok(res, {
      status: 'up',
      db: 'up',
      dbLatencyMs: Date.now() - started,
      uptimeSec: Math.round(process.uptime()),
      node: process.version,
    })
  } catch (e) {
    return res.status(503).json({
      code: 50300,
      data: null,
      message: `数据库不可用：${(e as Error).message}`,
    })
  }
})
