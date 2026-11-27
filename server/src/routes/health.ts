import { Router } from 'express'
import { prisma } from '../lib/db'
import { ok } from '../lib/http'
import { aiReady } from '../env'

export const healthRouter = Router()

/**
 * GET /api/health
 * 返回进程与数据库状态。数据库打不开时返回 503，便于快速判断"是代码问题还是库问题"。
 *
 * `aiReady` 是给首页用的：语言测评那张卡要不要置灰，必须在前端就能知道，
 * 否则只能"点进去才发现没开"。这个字段只说开关，不泄露任何配置值。
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
      aiReady,
    })
  } catch (e) {
    return res.status(503).json({
      code: 50300,
      data: null,
      message: `数据库不可用：${(e as Error).message}`,
    })
  }
})
