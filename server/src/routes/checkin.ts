import { Router } from 'express'
import { prisma } from '../lib/db'
import { ok, route } from '../lib/http'
import { requireAuth } from '../middleware/auth'
import { grant } from '../services/points'
import { evaluateBadges } from '../services/badges'
import { dateKey, getStreak, hasStudiedToday } from '../services/streak'
import { STREAK_TARGET, type CheckinView } from '../../../shared/index'

export const checkinRouter = Router()

/**
 * POST /api/checkin
 *
 * 自动打卡。前端在每次启动、以及登录成功后各调一次（幂等，多调无害）。
 *
 * 这里有一个刻意的产品判断：**打卡 = 今天真的学了**，不是"点一下签到"。
 * 方案里 3 分打卡 + 连续 7 天 20 分，如果做成点按钮签到，
 * 孩子会养成"每天来点一下就关掉"的习惯，连续天数也就失去了意义。
 * 所以判定条件是"今天有没有学习记录"（查词条、展开雅词、完成闯关都会留下记录），
 * 光打开首页不产生记录，不算打卡。
 *
 * 副作用上它是"事后追认"：孩子学完第一个词条，系统才回头把今天的打卡分补上。
 * 这也是为什么它不放在任何单独的页面按钮上——没有需要孩子执行的"签到动作"。
 */
checkinRouter.post(
  '/checkin',
  requireAuth,
  route(async (req, res) => {
    const userId = req.userId!
    const today = dateKey(new Date())

    // bizId 用日期键：这就是"每天最多一次"的幂等键，不需要额外字段
    const already = await prisma.pointRecord.findUnique({
      where: { userId_bizType_bizId: { userId, bizType: 'DAILY_CHECKIN', bizId: today } },
      select: { id: true },
    })

    if (already) {
      const data: CheckinView = {
        checkedIn: true,
        reason: 'already',
        streak: await getStreak(userId),
        points: null,
        streakPoints: null,
        newBadges: [],
      }
      return ok(res, data)
    }

    if (!(await hasStudiedToday(userId))) {
      const data: CheckinView = {
        checkedIn: false,
        reason: 'no_activity',
        // 今天还没学，但昨天的连续不该断 —— getStreak 已经把这种情况算进去了
        streak: await getStreak(userId),
        points: null,
        streakPoints: null,
        newBadges: [],
      }
      return ok(res, data)
    }

    const points = await grant(userId, 'DAILY_CHECKIN', today)
    const streak = await getStreak(userId)

    /**
     * 连续 7 天给 20 分，第 14、21……天同样给。
     * bizId 里带天数（`2026-11-16#7`），所以"第 7 天"和"第 14 天"是两条不同的流水，
     * 而"同一个第 7 天"重复调用仍然是幂等的。
     */
    const streakPoints =
      streak > 0 && streak % STREAK_TARGET === 0
        ? await grant(userId, 'STREAK_BONUS', `${today}#${streak}`)
        : null

    const newBadges = await evaluateBadges(userId)

    const data: CheckinView = {
      checkedIn: true,
      reason: 'ok',
      streak,
      points,
      streakPoints,
      newBadges,
    }
    return ok(res, data)
  }),
)
