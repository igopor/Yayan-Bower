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

/**
 * 按情景类型汇总错题。
 *
 * 只统计**最近几轮**而不是全部历史：AI 小结要说的是"现在该练什么"，
 * 把三个月前刚上手时的错题算进去，建议就会永远停在原地。
 *
 * 为什么单独一个函数、不并进 `ReportStats`：
 * 现有三段文案的阈值判断都建立在那 10 个字段上，动它就要重跑 5625 组组合测试；
 * 而这份数据只有 AI 用得上，放边上即可。少改一处就少一处回归。
 */
export interface ScenarioWeakness {
  scenarioType: string
  wrong: number
  total: number
}

export async function getScenarioWeakness(
  userId: number,
  limitSessions = 5,
): Promise<ScenarioWeakness[]> {
  const sessions = await prisma.quizSession.findMany({
    where: { userId, status: 'finished' },
    orderBy: { finishedAt: 'desc' },
    take: limitSessions,
    select: { id: true },
  })
  if (sessions.length === 0) return []

  const items = await prisma.quizSessionItem.findMany({
    // isCorrect 为 null = 超时未作答，判分规则里算错，但这里不重复计入（结算已按 0 分处理）
    where: { sessionId: { in: sessions.map((s) => s.id) }, isCorrect: { not: null } },
    select: { questionId: true, isCorrect: true },
  })
  if (items.length === 0) return []

  const questions = await prisma.quizQuestion.findMany({
    where: { id: { in: [...new Set(items.map((i) => i.questionId))] } },
    select: { id: true, scenarioType: true },
  })
  const typeOf = new Map(questions.map((q) => [q.id, q.scenarioType]))

  const agg = new Map<string, { wrong: number; total: number }>()
  for (const item of items) {
    const type = typeOf.get(item.questionId)
    if (!type) continue
    const cur = agg.get(type) ?? { wrong: 0, total: 0 }
    cur.total += 1
    if (!item.isCorrect) cur.wrong += 1
    agg.set(type, cur)
  }

  return [...agg.entries()]
    .map(([scenarioType, v]) => ({ scenarioType, ...v }))
    .sort((a, b) => b.wrong - a.wrong || b.total - a.total)
}
