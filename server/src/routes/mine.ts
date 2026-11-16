import { Router } from 'express'
import { prisma } from '../lib/db'
import { ok, ApiError, route } from '../lib/http'
import { requireAuth } from '../middleware/auth'
import { DAILY_VIEW_CAP, type MineView } from '../../../shared/index'
import { getTodayEarned, getTodayViewEarned } from '../services/points'
import { listBadges } from '../services/badges'
import { getReportStats } from '../services/stats'
import { dateKey } from '../services/streak'
import { maskPhone } from '../services/user'

export const mineRouter = Router()

/**
 * GET /api/mine
 *
 * 「我的」页一次拿全。为什么不在前端并发调 /auth/me + /points/summary + /badges + /favorites：
 * 四个请求里任何一个慢，页面就会分批"跳"出内容（积分先到、徽章后到），
 * 观感比多等 30 毫秒差得多。这里合成一次，前端一次渲染完。
 *
 * 数字全部来自 `getReportStats` —— 与家校反馈页共用同一套算法，
 * 避免出现"我的页说 8 轮、报告说 7 轮"这种家长立刻能发现的矛盾。
 */
mineRouter.get(
  '/mine',
  requireAuth,
  route(async (req, res) => {
    const userId = req.userId!

    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw ApiError.notFound('账号不存在')

    const [stats, badges, favorites, today, todayView, checkinToday] = await Promise.all([
      getReportStats(userId, user.nickname),
      listBadges(userId),
      prisma.favorite.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        include: { term: true },
      }),
      getTodayEarned(userId),
      getTodayViewEarned(userId),
      prisma.pointRecord.findUnique({
        where: {
          userId_bizType_bizId: {
            userId,
            bizType: 'DAILY_CHECKIN',
            bizId: dateKey(new Date()),
          },
        },
        select: { id: true },
      }),
    ])

    const data: MineView = {
      user: {
        id: user.id,
        nickname: user.nickname,
        phone: maskPhone(user.phone),
        totalPoints: stats.totalPoints,
        todayEarned: today,
        badgeCount: stats.badgeCount,
      },
      points: {
        total: stats.totalPoints,
        today,
        todayView,
        viewCap: DAILY_VIEW_CAP,
      },
      streak: stats.streak,
      checkedInToday: !!checkinToday,
      badges,
      favorites: favorites.map((f) => ({
        termId: f.termId,
        name: f.term.name,
        plainMeaning: f.term.plainMeaning,
        hasElegant: f.term.hasElegant,
        favoritedAt: f.createdAt.toISOString(),
      })),
      termCount: stats.termCount + stats.elegantCount,
      quizRounds: stats.quizRounds,
    }
    return ok(res, data)
  }),
)
