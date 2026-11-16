import { prisma } from '../lib/db'
import { BADGES, STREAK_TARGET, type BadgeDef, type BadgeView } from '../../../shared/index'
import { getBalance } from './points'
import { getStreak } from './streak'

/**
 * 徽章判定。
 *
 * 设计上只有两个决定：
 *
 * 1. **定义写在代码里，只把"谁解锁了哪个"写进 `user_badge`。**
 *    徽章是规则不是数据，不该有一条后台能改的记录。将来换图标/改名字只改 `shared/badges.ts`。
 *
 * 2. **事件触发，不做定时任务。**
 *    每次"可能让某个条件成立"的动作结束后调一次 `evaluateBadges()`。
 *    代价是每次多一两次查询；换来的是徽章解锁提示可以当场飘出来，
 *    而不是"明天打开网站发现多了个徽章"。本项目单机 SQLite，这点查询是微秒级。
 *
 * 判定函数自己保证幂等：已解锁的直接跳过，写入用 upsert（并发也不会报 P2002）。
 */

const FAVORITE_THRESHOLD = 20
const POINTS_THRESHOLD = 500

/** 惰性求值 + 缓存：同一次判定里只查一次 */
function memo<T>(fn: () => Promise<T>): () => Promise<T> {
  let cache: Promise<T> | null = null
  return () => (cache ??= fn())
}

export async function evaluateBadges(userId: number): Promise<BadgeDef[]> {
  const owned = await prisma.userBadge.findMany({
    where: { userId },
    select: { badgeCode: true },
  })
  const ownedSet = new Set(owned.map((o) => o.badgeCode))
  const pending = BADGES.filter((b) => !ownedSet.has(b.code))
  // 6 枚全拿到之后，这一步只剩这一次查询
  if (pending.length === 0) return []

  // 事实只查一次，多个徽章共用
  const loadViews = memo(() => prisma.pointRecord.count({ where: { userId, bizType: { in: ['TERM_VIEW', 'ELEGANT_VIEW'] } } }))
  const loadQuizzes = memo(() =>
    prisma.quizSession.findMany({
      where: { userId, status: 'finished' },
      select: { correctCount: true, total: true },
    }),
  )
  const loadFavorites = memo(() => prisma.favorite.count({ where: { userId } }))
  const loadPoints = memo(() => getBalance(userId))
  const loadStreak = memo(() => getStreak(userId))

  const eligible: Record<string, () => Promise<boolean>> = {
    FIRST_TERM: async () => (await loadViews()) > 0,
    FIRST_QUIZ: async () => (await loadQuizzes()).length > 0,
    // 满分 = 这一轮全部答对。注意与"积分奖励"不是一回事：
    // 正确率 80% 就给额外积分（QUIZ_PERFECT_RATE），但徽章要求满分。
    QUIZ_PERFECT: async () =>
      (await loadQuizzes()).some((s) => s.total > 0 && s.correctCount === s.total),
    STREAK_7: async () => (await loadStreak()) >= STREAK_TARGET,
    FAVORITE_20: async () => (await loadFavorites()) >= FAVORITE_THRESHOLD,
    POINTS_500: async () => (await loadPoints()) >= POINTS_THRESHOLD,
  }

  const unlocked: BadgeDef[] = []
  for (const badge of pending) {
    const check = eligible[badge.code]
    if (check && (await check())) unlocked.push(badge)
  }
  if (unlocked.length === 0) return []

  for (const badge of unlocked) {
    await prisma.userBadge.upsert({
      where: { userId_badgeCode: { userId, badgeCode: badge.code } },
      create: { userId, badgeCode: badge.code },
      update: {},
    })
  }
  return unlocked
}

/** 徽章墙：6 枚定义 + 我解锁了没有 */
export async function listBadges(userId: number): Promise<BadgeView[]> {
  const owned = await prisma.userBadge.findMany({
    where: { userId },
    select: { badgeCode: true, unlockedAt: true },
  })
  const map = new Map(owned.map((o) => [o.badgeCode, o.unlockedAt]))

  return BADGES.map((b) => ({
    ...b,
    unlocked: map.has(b.code),
    unlockedAt: map.get(b.code)?.toISOString() ?? null,
  }))
}
