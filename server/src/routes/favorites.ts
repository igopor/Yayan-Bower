import { Router } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/db'
import { ok, ApiError, route } from '../lib/http'
import { parse } from '../lib/validate'
import { requireAuth } from '../middleware/auth'
import { grant } from '../services/points'
import { evaluateBadges } from '../services/badges'
import type { BadgeDef, GrantResult } from '../../../shared/index'

export const favoritesRouter = Router()

/**
 * POST /api/favorites { termId }
 *
 * 收藏 + 首次收藏给 1 分。
 *
 * 三个容易踩的点：
 * 1. 重复收藏不能报错。孩子连点两下，第二次要返回"已收藏"而不是错误弹窗。
 *    这里靠 `UNIQUE(user_id, term_id)` + 捕获 P2002，不靠"先查再插"（并发挡不住）。
 * 2. 积分只给一次，靠积分内核自己的幂等键，不在这里判重。
 * 3. 取消后再收藏不重复给分 —— 这是有意的：反复取消/收藏刷分是这类产品最常见的漏洞。
 */
favoritesRouter.post(
  '/favorites',
  requireAuth,
  route(async (req, res) => {
    const { termId } = parse(
      z.object({ termId: z.coerce.number().int().positive() }),
      req.body,
    )
    const userId = req.userId!

    const term = await prisma.term.findUnique({
      where: { id: termId },
      select: { id: true },
    })
    if (!term) throw ApiError.notFound('词条不存在')

    try {
      await prisma.favorite.create({ data: { userId, termId } })
    } catch (e) {
      // 已经收藏过：不当错误处理，直接走下面的加分逻辑
      // （加分本身也是幂等的，第二次会返回 duplicate 且不加分）
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) {
        throw e
      }
    }

    let points: GrantResult | null = null
    let newBadges: BadgeDef[] = []
    try {
      points = await grant(userId, 'FAVORITE', termId)
      // 第 20 条收藏会解锁「收藏家」
      newBadges = await evaluateBadges(userId)
    } catch (e) {
      console.error('[favorites] 收藏积分/徽章判定失败', { userId, termId, err: e })
    }

    return ok(res, { favorited: true, points, newBadges })
  }),
)

/**
 * DELETE /api/favorites/:termId
 * 取消收藏。**不扣分** —— 积分只能加不能减，否则会出现负分和"我明明攒够了又变少了"的投诉。
 */
favoritesRouter.delete(
  '/favorites/:termId',
  requireAuth,
  route(async (req, res) => {
    const termId = Number(req.params.termId)
    if (!Number.isInteger(termId) || termId <= 0) throw ApiError.badRequest('参数不正确')

    await prisma.favorite.deleteMany({ where: { userId: req.userId!, termId } })
    return ok(res, { favorited: false, points: null, newBadges: [] })
  }),
)

/**
 * GET /api/favorites
 * 我的收藏列表，「我的」页用。取消后立刻刷新即可看到少了一条。
 */
favoritesRouter.get(
  '/favorites',
  requireAuth,
  route(async (req, res) => {
    const rows = await prisma.favorite.findMany({
      where: { userId: req.userId! },
      orderBy: { createdAt: 'desc' },
      include: { term: true },
    })

    return ok(
      res,
      rows.map((r) => ({
        termId: r.termId,
        name: r.term.name,
        plainMeaning: r.term.plainMeaning,
        hasElegant: r.term.hasElegant,
        favoritedAt: r.createdAt,
      })),
    )
  }),
)
