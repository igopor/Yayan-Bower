import { prisma } from '../lib/db'
import type { ReportStats } from '../../../shared/index'
import { getBalance } from './points'
import { calcStreak, dateKey, getActiveDates } from './streak'

/**
 * 报告用的一整套数字。
 *
 * **全部实时算，不建聚合表。** 一个学生一学期的数据是"几十条词条 + 几十轮闯关"的量级，
 * 每次打开报告页做几条 count 毫无压力；而多一张聚合表就多一处"需要同步、可能不同步"的地方。
 * 真到需要优化的量级，那时也该换 Postgres 了，不是这个项目的问题。
 *
 * 「我的」页也会调它——同一个数字只能有一个算法，否则报告和我的页对不上，
 * 家长一眼就能看出来。
 */
export async function getReportStats(userId: number, nickname: string): Promise<ReportStats> {
  const [termViews, elegantViews, favoriteCount, quizzes, dates, badgeCount, totalPoints] =
    await Promise.all([
      // 浏览积分靠 (user, biz_type, biz_id) 唯一键去重，所以"记录条数"就等于"看过几个词条"
      prisma.pointRecord.count({ where: { userId, bizType: 'TERM_VIEW' } }),
      prisma.pointRecord.count({ where: { userId, bizType: 'ELEGANT_VIEW' } }),
      prisma.favorite.count({ where: { userId } }),
      prisma.quizSession.findMany({
        where: { userId, status: 'finished' },
        select: { correctCount: true, total: true },
      }),
      getActiveDates(userId),
      prisma.userBadge.count({ where: { userId } }),
      getBalance(userId),
    ])

  const quizRounds = quizzes.length
  const quizAvgAccuracy =
    quizRounds === 0
      ? 0
      : Math.round(
          quizzes.reduce((sum, q) => sum + (q.total > 0 ? (q.correctCount / q.total) * 100 : 0), 0) /
            quizRounds,
        )

  return {
    nickname,
    termCount: termViews,
    elegantCount: elegantViews,
    favoriteCount,
    quizRounds,
    quizAvgAccuracy,
    streak: calcStreak(dates, dateKey(new Date())),
    activeDays: dates.length,
    badgeCount,
    totalPoints,
    generatedAt: new Date().toISOString(),
  }
}
