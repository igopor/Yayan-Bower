import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../lib/db'
import { getBalance, getTodayEarned, getTodayViewEarned, grant } from './points'
import { DAILY_VIEW_CAP, POINT_RULES } from '../../../shared/index'

/**
 * 这些用例直接连 dev.db，用一个专用手机号的临时用户，跑完删掉。
 * 不另建测试库：SQLite 建库要走 prisma CLI，在测试进程里做不到，
 * 而为测试引一套建表逻辑的复杂度超过它带来的收益。
 * 前提是本机已执行过 `npm run db:push`。
 */
const TEST_PHONE = '19900000001'
let userId: number

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { phone: TEST_PHONE } })
  const u = await prisma.user.create({ data: { phone: TEST_PHONE } })
  userId = u.id
})

afterAll(async () => {
  // 删除用户会级联删掉 point_record（schema 里设了 onDelete: Cascade）
  await prisma.user.deleteMany({ where: { phone: TEST_PHONE } })
})

beforeEach(async () => {
  await prisma.pointRecord.deleteMany({ where: { userId } })
})

describe('积分发放', () => {
  it('首次发放按规则分值到账', async () => {
    const r = await grant(userId, 'TERM_VIEW', 1)
    expect(r.granted).toBe(true)
    expect(r.delta).toBe(POINT_RULES.TERM_VIEW)
    expect(r.balance).toBe(POINT_RULES.TERM_VIEW)
    expect(await getBalance(userId)).toBe(POINT_RULES.TERM_VIEW)
  })

  it('同一业务重复发放 100 次，余额只增一次', async () => {
    for (let i = 0; i < 100; i++) {
      await grant(userId, 'FAVORITE', 'term-7')
    }
    expect(await getBalance(userId)).toBe(POINT_RULES.FAVORITE)

    const count = await prisma.pointRecord.count({ where: { userId } })
    expect(count).toBe(1)
  })

  it('重复发放返回 duplicate，且不动余额', async () => {
    await grant(userId, 'FAVORITE', 'term-1')
    const r = await grant(userId, 'FAVORITE', 'term-1')
    expect(r.granted).toBe(false)
    expect(r.reason).toBe('duplicate')
    expect(r.delta).toBe(0)
    expect(r.balance).toBe(POINT_RULES.FAVORITE)
  })

  it('并发 10 次同一业务，只入账一条', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => grant(userId, 'FAVORITE', 'term-concurrent')),
    )
    expect(results.filter((r) => r.granted)).toHaveLength(1)
    expect(await prisma.pointRecord.count({ where: { userId } })).toBe(1)
    expect(await getBalance(userId)).toBe(POINT_RULES.FAVORITE)
  })

  it('bizType 不同则视为不同业务，各自发放', async () => {
    await grant(userId, 'TERM_VIEW', 5)
    await grant(userId, 'ELEGANT_VIEW', 5)
    expect(await prisma.pointRecord.count({ where: { userId } })).toBe(2)
  })

  it('balanceAfter 与实际求和一致', async () => {
    await grant(userId, 'TERM_VIEW', 1)
    await grant(userId, 'TERM_VIEW', 2)
    await grant(userId, 'FAVORITE', 3)

    const recs = await prisma.pointRecord.findMany({
      where: { userId },
      orderBy: { id: 'asc' },
    })
    let sum = 0
    for (const r of recs) {
      sum += r.delta
      expect(r.balanceAfter).toBe(sum)
    }
    expect(sum).toBe(await getBalance(userId))
  })

  it('用户不存在时抛错，且不留下脏流水', async () => {
    await expect(grant(999999, 'FAVORITE', 1)).rejects.toThrow()
    const count = await prisma.pointRecord.count({ where: { userId: 999999 } })
    expect(count).toBe(0)
  })

  it('overrideDelta 可以覆盖默认分值', async () => {
    const r = await grant(userId, 'QUIZ_PERFECT', 'session-1', 15)
    expect(r.delta).toBe(15)
    expect(r.balance).toBe(15)
  })
})

describe('浏览类日上限', () => {
  it('加满上限后不再发放，理由是 daily_cap', async () => {
    const per = POINT_RULES.TERM_VIEW
    const times = DAILY_VIEW_CAP / per // 20 / 2 = 10

    for (let i = 1; i <= times; i++) {
      const r = await grant(userId, 'TERM_VIEW', `term-${i}`)
      expect(r.granted).toBe(true)
    }
    expect(await getTodayViewEarned(userId)).toBe(DAILY_VIEW_CAP)

    const blocked = await grant(userId, 'TERM_VIEW', 'term-over')
    expect(blocked.granted).toBe(false)
    expect(blocked.reason).toBe('daily_cap')
    expect(await getBalance(userId)).toBe(DAILY_VIEW_CAP)
  })

  it('雅词与词条共用同一个浏览额度', async () => {
    for (let i = 1; i <= 5; i++) await grant(userId, 'TERM_VIEW', `t-${i}`)
    for (let i = 1; i <= 5; i++) await grant(userId, 'ELEGANT_VIEW', `e-${i}`)
    expect(await getTodayViewEarned(userId)).toBe(DAILY_VIEW_CAP)

    const blocked = await grant(userId, 'ELEGANT_VIEW', 'e-over')
    expect(blocked.reason).toBe('daily_cap')
  })

  it('日上限不影响非浏览类业务', async () => {
    for (let i = 1; i <= 10; i++) await grant(userId, 'TERM_VIEW', `t-${i}`)
    expect((await grant(userId, 'TERM_VIEW', 't-over')).reason).toBe('daily_cap')

    // 收藏、闯关、打卡不受浏览上限约束
    expect((await grant(userId, 'FAVORITE', 'f-1')).granted).toBe(true)
    expect((await grant(userId, 'QUIZ_FINISH', 's-1')).granted).toBe(true)
    expect((await grant(userId, 'DAILY_CHECKIN', '2026-11-15')).granted).toBe(true)

    const total = await getBalance(userId)
    expect(total).toBe(
      DAILY_VIEW_CAP +
        POINT_RULES.FAVORITE +
        POINT_RULES.QUIZ_FINISH +
        POINT_RULES.DAILY_CHECKIN,
    )
  })

  it('今日获得只统计正数', async () => {
    await grant(userId, 'TERM_VIEW', 1)
    expect(await getTodayEarned(userId)).toBe(POINT_RULES.TERM_VIEW)
    expect(await getTodayEarned(userId)).toBeGreaterThan(0)
  })
})
