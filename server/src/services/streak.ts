import { prisma } from '../lib/db'

/**
 * 连续打卡天数。
 *
 * 打卡不建表 —— "今天有没有打卡"等价于"今天有没有学习记录"，
 * 而学习记录本来就在 `point_record` 里（查词条、展开雅词、完成闯关都会写一条）。
 * 多建一张表就多一处可能和流水对不上的地方。
 *
 * 这里把"算连续天数"做成纯函数，因为它最容易错在日期边界上
 * （月底、年底、今天还没学）。纯函数才能把这些情况全测一遍。
 */

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** 本地日期键 `YYYY-MM-DD`。用本地而不是 UTC：中国时区下 UTC 会差 8 小时，早上 8 点前算前一天 */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * 日期键前后移动若干天。
 *
 * 用 `Date.UTC` 做加减：日期键本身不含时间与时区，
 * 按 UTC 计算不会被夏令时/时区偏移干扰（中国无夏令时，但这条规则值得写成通用的）。
 */
export function shiftDay(key: string, delta: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d) + delta * 86_400_000)
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/**
 * 连续天数。
 *
 * 起点判定是关键：**今天还没学不算断**。
 * 昨晚学到 11 点，今天早上打开网站，如果严格从今天往回数，会显示 0 天 ——
 * 用户看到"连续 0 天"会以为自己白攒了。所以今天没有记录时从昨天开始数。
 * 只有"今天和昨天都没有"才算真的断了。
 */
export function calcStreak(dates: Iterable<string>, today: string): number {
  const set = new Set(dates)
  if (set.size === 0) return 0

  let cursor: string
  if (set.has(today)) {
    cursor = today
  } else {
    const yesterday = shiftDay(today, -1)
    if (!set.has(yesterday)) return 0
    cursor = yesterday
  }

  let days = 0
  while (set.has(cursor)) {
    days++
    cursor = shiftDay(cursor, -1)
  }
  return days
}

/** 一组时间点 → 去重后的本地日期键（倒序，方便看最近几天） */
export function toDateKeys(list: Date[]): string[] {
  const set = new Set(list.map(dateKey))
  return [...set].sort().reverse()
}

/**
 * 该用户所有"有学习记录"的本地日期。
 *
 * 为什么取回全部 createdAt 在内存里去重，而不是写 SQL 的 `date(createdAt,'localtime')`：
 * SQL 的 localtime 取的是数据库进程的时区，JS 的 getFullYear 取的是 Node 进程的时区，
 * 两者一旦不一致（比如部署时只给其中一个设了 TZ），"今天"的判定就会错一天。
 * 一个学生一学期最多几千条记录，取回来映射一遍是几毫秒的事，换来的是只有一处时区来源。
 * 真到十万级再改 SQL 聚合并统一 TZ。
 */
export async function getActiveDates(userId: number): Promise<string[]> {
  const rows = await prisma.pointRecord.findMany({
    where: { userId },
    select: { createdAt: true },
    orderBy: { createdAt: 'desc' },
  })
  return toDateKeys(rows.map((r) => r.createdAt))
}

/** 当前连续天数 */
export async function getStreak(userId: number): Promise<number> {
  const dates = await getActiveDates(userId)
  return calcStreak(dates, dateKey(new Date()))
}

/** 今天是否为"有学习记录"的一天（不含打卡/连续奖励本身的流水） */
export async function hasStudiedToday(userId: number): Promise<boolean> {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const n = await prisma.pointRecord.count({
    where: {
      userId,
      createdAt: { gte: start },
      // 打卡分与连续奖励是"学习的回报"，不能反过来当作"今天学过"的证据
      bizType: { notIn: ['DAILY_CHECKIN', 'STREAK_BONUS'] },
    },
  })
  return n > 0
}
