import { Prisma } from '@prisma/client'
import { prisma } from '../lib/db'
import {
  DAILY_VIEW_CAP,
  POINT_RULES,
  VIEW_BIZ_TYPES,
  type GrantReason,
  type GrantResult,
  type PointBizType,
} from '../../../shared/index'

/**
 * 积分内核。全站唯一允许写 point_record 的地方。
 *
 * 四个模块（辨析、雅词、挑战、我的）都只调 `grant()` 一行，不在各自代码里
 * 新增/修改积分数值——否则分值规则会散落到四处，改一次要改四个地方。
 */

export type { GrantReason, GrantResult }

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/** 总积分 = 流水求和。没有冗余字段，就不会出现"总分和流水对不上"。 */
export async function getBalance(userId: number): Promise<number> {
  const r = await prisma.pointRecord.aggregate({
    where: { userId },
    _sum: { delta: true },
  })
  return r._sum.delta ?? 0
}

/** 今天获得的正积分（扣分不算进"今日获得"） */
export async function getTodayEarned(userId: number): Promise<number> {
  const r = await prisma.pointRecord.aggregate({
    where: { userId, createdAt: { gte: startOfToday() }, delta: { gt: 0 } },
    _sum: { delta: true },
  })
  return r._sum.delta ?? 0
}

/** 今天在浏览类（词条/雅词）上已经拿了多少分，用于日上限判断 */
export async function getTodayViewEarned(userId: number): Promise<number> {
  const r = await prisma.pointRecord.aggregate({
    where: {
      userId,
      bizType: { in: VIEW_BIZ_TYPES },
      createdAt: { gte: startOfToday() },
      delta: { gt: 0 },
    },
    _sum: { delta: true },
  })
  return r._sum.delta ?? 0
}

/**
 * 发放积分。
 *
 * @param userId  用户
 * @param bizType 业务类型，决定默认分值
 * @param bizId   业务主键。**同一个 (userId, bizType, bizId) 永远只发一次**
 * @param overrideDelta 需要按情况给不同分值时传入（如闯关按正确率）
 *
 * 三道防线，缺一不可：
 * 1. 唯一索引 `(user_id, biz_type, biz_id)` —— 数据库层兜底，并发也拦得住
 * 2. 事务内先写流水再求和回填 `balance_after` —— 保证流水里的"加完是几分"是准的
 * 3. 浏览类日上限 —— 防止刷分
 *
 * 为什么第 1 条必须靠数据库而不是"先查一下有没有"：
 * 学生连点两下收藏，两个请求几乎同时到达，两个都查到"没有"，然后都插入。
 * 应用层的检查挡不住这种并发，只有唯一索引能。
 */
export async function grant(
  userId: number,
  bizType: PointBizType,
  bizId: string | number,
  overrideDelta?: number,
): Promise<GrantResult> {
  const delta = overrideDelta ?? POINT_RULES[bizType]
  const id = String(bizId)

  // 快速失败：绝大多数重复请求在这里就返回了，省掉一次必然失败的事务。
  // 真正保证幂等的是下面的唯一索引，这里只是优化。
  const exists = await prisma.pointRecord.findUnique({
    where: { userId_bizType_bizId: { userId, bizType, bizId: id } },
    select: { id: true },
  })
  if (exists) {
    return { granted: false, delta: 0, balance: await getBalance(userId), reason: 'duplicate' }
  }

  // 浏览类日上限
  if (VIEW_BIZ_TYPES.includes(bizType)) {
    const earned = await getTodayViewEarned(userId)
    if (earned + delta > DAILY_VIEW_CAP) {
      return { granted: false, delta: 0, balance: await getBalance(userId), reason: 'daily_cap' }
    }
  }

  try {
    const balance = await prisma.$transaction(async (tx) => {
      // balanceAfter 先写 0，插入后再求和回填。
      // 为什么不直接算"当前总和 + delta"：两个并发事务可能读到同样的总和，
      // 各自算出同一个 balanceAfter，后写入的那条快照就是错的。
      // 插入后求和拿到的是"包含自己这一笔"的真实值。
      await tx.pointRecord.create({
        data: { userId, bizType, bizId: id, delta, balanceAfter: 0 },
      })
      const agg = await tx.pointRecord.aggregate({
        where: { userId },
        _sum: { delta: true },
      })
      const after = agg._sum.delta ?? 0
      await tx.pointRecord.update({
        where: { userId_bizType_bizId: { userId, bizType, bizId: id } },
        data: { balanceAfter: after },
      })
      return after
    })

    return { granted: true, delta, balance, reason: 'ok' }
  } catch (e) {
    // P2002 = 唯一约束冲突。说明另一个并发请求抢先写入了，这次就算重复。
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return { granted: false, delta: 0, balance: await getBalance(userId), reason: 'duplicate' }
    }
    throw e
  }
}
