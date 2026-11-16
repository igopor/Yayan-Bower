import { prisma } from '../lib/db'
import type { UserSummary } from '../../../shared/index'

/** 手机号脱敏：13812348000 → 138****8000 */
export function maskPhone(phone: string): string {
  if (phone.length !== 11) return phone
  return `${phone.slice(0, 3)}****${phone.slice(7)}`
}

/**
 * 组装前端需要的用户摘要。
 *
 * 积分数值不存冗余字段，直接从 point_record 求和。
 * 为什么：总分和流水求和出现不一致，是小学生家长一眼就能发现的破绽
 * （"我今天明明加了分，总数没动"）。求和比维护冗余字段慢不了多少，
 * 但永远不会对不上。数据量到十万级再考虑加缓存。
 */
export async function buildUserSummary(user: {
  id: number
  nickname: string
  phone: string
}): Promise<UserSummary> {
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)

  const [total, today, badgeCount] = await Promise.all([
    prisma.pointRecord.aggregate({ where: { userId: user.id }, _sum: { delta: true } }),
    prisma.pointRecord.aggregate({
      where: { userId: user.id, createdAt: { gte: startOfDay }, delta: { gt: 0 } },
      _sum: { delta: true },
    }),
    prisma.userBadge.count({ where: { userId: user.id } }),
  ])

  return {
    id: user.id,
    nickname: user.nickname,
    phone: maskPhone(user.phone),
    totalPoints: total._sum.delta ?? 0,
    todayEarned: today._sum.delta ?? 0,
    badgeCount,
  }
}
