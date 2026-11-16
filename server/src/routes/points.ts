import { Router } from 'express'
import { z } from 'zod'
import { ok, route } from '../lib/http'
import { parse } from '../lib/validate'
import { requireAuth } from '../middleware/auth'
import { prisma } from '../lib/db'
import { DAILY_VIEW_CAP } from '../../../shared/index'
import { getBalance, getTodayEarned, getTodayViewEarned } from '../services/points'

export const pointsRouter = Router()

/**
 * GET /api/points/summary
 * 积分概览。三次数值都实时从流水求和，不存冗余字段——
 * 一次多查两个 aggregate 的代价，远小于"总分和流水对不上"的风险。
 */
pointsRouter.get(
  '/points/summary',
  requireAuth,
  route(async (req, res) => {
    const userId = req.userId!
    const [total, today, todayView] = await Promise.all([
      getBalance(userId),
      getTodayEarned(userId),
      getTodayViewEarned(userId),
    ])
    return ok(res, { total, today, todayView, viewCap: DAILY_VIEW_CAP })
  }),
)

/**
 * GET /api/points/records?limit=20
 * 积分流水，倒序。「我的」页用它显示"最近获得"，也是排查"为什么加了/没加"的依据。
 */
pointsRouter.get(
  '/points/records',
  requireAuth,
  route(async (req, res) => {
    const { limit } = parse(
      z.object({
        limit: z.coerce.number().int().min(1).max(100).default(20),
      }),
      req.query,
    )

    const rows = await prisma.pointRecord.findMany({
      where: { userId: req.userId! },
      orderBy: { id: 'desc' },
      take: limit,
    })

    return ok(
      res,
      rows.map((r) => ({
        id: r.id,
        bizType: r.bizType,
        bizId: r.bizId,
        delta: r.delta,
        balanceAfter: r.balanceAfter,
        createdAt: r.createdAt,
      })),
    )
  }),
)
