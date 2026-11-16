import 'dotenv/config'
/**
 * 阶段 7 接口冒烟测试（我的 / 打卡 / 徽章 / 家校反馈）。
 *
 * 覆盖：
 * - 新用户零值（/mine 不 500、不发假数据）
 * - 打卡只在"今天真学过"时发生；重复调用不再加分
 * - 6 枚徽章各自能触发，且不重复解锁
 * - 连续 7 天：跨 6 天历史数据 → streak=7 → 额外 20 分 + 七日不辍
 * - /report/summary 与 /mine 数字一致；三段文案不空、不出现 0% 硬伤
 * - 未登录访问被拒
 *
 * 跑法：先启动服务，再
 *   npx tsx tools/smoke-stage7.ts
 */
import { prisma } from '../server/src/lib/db'
import { toDisplayPick } from '../server/src/services/quiz'

const BASE = 'http://localhost:3000/api'
const PHONE = '137' + String(Date.now()).slice(-8)
const PHONE_B = '135' + String(Date.now()).slice(-8)

let pass = 0
let fail = 0

function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}`, extra === undefined ? '' : JSON.stringify(extra))
  }
}

type Body = { code: number; data: any; message: string }

async function call(path: string, init: RequestInit = {}, token?: string): Promise<Body> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers as any) },
  })
  return (await res.json()) as Body
}

const post = (p: string, body?: unknown, token?: string) =>
  call(p, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }, token)
const get = (p: string, token?: string) => call(p, { method: 'GET' }, token)

async function login(phone: string): Promise<{ token: string; userId: number }> {
  await post('/auth/sms/send', { phone })
  const r = await post('/auth/sms/login', { phone, code: '123456', agreed: true })
  return { token: r.data.token, userId: r.data.user.id }
}

/** 做一轮全对的闯关。**不在这里结算** —— 结算要把 newBadges 交给断言看 */
async function playPerfectRound(token: string): Promise<{ sessionId: number; total: number }> {
  const s = await post('/quiz/sessions', undefined, token)
  const sessionId = s.data.sessionId as number
  for (let seq = 1; seq <= s.data.total; seq++) {
    await post(`/quiz/sessions/${sessionId}/start`, { seq }, token)
    const item = await prisma.quizSessionItem.findFirst({ where: { sessionId, seq } })
    const q = await prisma.quizQuestion.findUnique({ where: { id: item!.questionId } })
    const pick = toDisplayPick(q!.correctOption as 'A' | 'B', item!.displaySwap)
    await post(`/quiz/sessions/${sessionId}/answers`, { seq, pick }, token)
  }
  return { sessionId, total: s.data.total }
}

function startOfDaysAgo(n: number): Date {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() - n)
  return d
}

async function main() {
  console.log('\n── 新用户：零值而不是报错 ──')
  const { token, userId } = await login(PHONE)

  const mine0 = await get('/mine', token)
  check('/mine 200', mine0.code === 0, mine0.message)
  check('积分 0', mine0.data?.points?.total === 0, mine0.data?.points)
  check('连续天数 0', mine0.data?.streak === 0, mine0.data?.streak)
  check('今天未打卡', mine0.data?.checkedInToday === false)
  check('徽章 6 枚全未解锁', mine0.data?.badges?.length === 6 && mine0.data.badges.every((b: any) => !b.unlocked))
  check('每枚徽章都有说明', mine0.data?.badges?.every((b: any) => b.description?.length > 4))
  check('收藏夹为空数组', Array.isArray(mine0.data?.favorites) && mine0.data.favorites.length === 0)
  check('查过词条数 0', mine0.data?.termCount === 0)
  check('手机号已脱敏', /^\d{3}\*{4}\d{4}$/.test(mine0.data?.user?.phone ?? ''), mine0.data?.user?.phone)

  console.log('\n── 打卡：今天没学就不打卡 ──')
  const c0 = await post('/checkin', undefined, token)
  check('未学习时 reason=no_activity', c0.data?.reason === 'no_activity', c0.data)
  check('未学习时不得分', c0.data?.points === null)
  check('未学习时 checkedIn=false', c0.data?.checkedIn === false)

  console.log('\n── 第一次查词条：解锁「初次查梗」 ──')
  const terms = await get('/terms?page=1', token)
  const t1 = terms.data.items[0].id
  const d1 = await get(`/terms/${t1}`, token)
  check('详情加分 +2', d1.data?.points?.delta === 2, d1.data?.points)
  check(
    '本次解锁 FIRST_TERM',
    d1.data?.newBadges?.some((b: any) => b.code === 'FIRST_TERM'),
    d1.data?.newBadges,
  )

  const d1again = await get(`/terms/${t1}`, token)
  check('重复打开不再加分', d1again.data?.points?.granted === false)
  check('重复打开不再重复解锁', (d1again.data?.newBadges ?? []).length === 0, d1again.data?.newBadges)

  console.log('\n── 学过之后再打卡 ──')
  const c1 = await post('/checkin', undefined, token)
  check('打卡成功', c1.data?.reason === 'ok', c1.data)
  check('打卡 +3 分', c1.data?.points?.delta === 3, c1.data?.points)
  check('连续 1 天', c1.data?.streak === 1, c1.data?.streak)
  const c2 = await post('/checkin', undefined, token)
  check('重复打卡 reason=already', c2.data?.reason === 'already', c2.data)
  check('重复打卡不加分', c2.data?.points === null)

  const today = new Date()
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const checkinRow = await prisma.pointRecord.findUnique({
    where: { userId_bizType_bizId: { userId, bizType: 'DAILY_CHECKIN', bizId: todayKey } },
  })
  check('打卡流水 bizId 是日期键', !!checkinRow, todayKey)

  console.log('\n── 收藏 20 条：解锁「收藏家」 ──')
  const allTerms = await prisma.term.findMany({ select: { id: true }, take: 21, orderBy: { id: 'asc' } })
  let lastFav: Body | null = null
  for (const t of allTerms.slice(0, 20)) {
    lastFav = await post('/favorites', { termId: t.id }, token)
  }
  check('第 20 条收藏解锁 FAVORITE_20', lastFav?.data?.newBadges?.some((b: any) => b.code === 'FAVORITE_20'), lastFav?.data?.newBadges)
  const favAgain = await post('/favorites', { termId: allTerms[0].id }, token)
  check('重复收藏不报错且不重复解锁', favAgain.code === 0 && (favAgain.data.newBadges ?? []).length === 0)

  console.log('\n── 闯关全对：解锁「首次闯关」+「满分达人」 ──')
  const round = await playPerfectRound(token)
  const result = await post(`/quiz/sessions/${round.sessionId}/finish`, undefined, token)
  const codes = (result.data?.newBadges ?? []).map((b: any) => b.code)
  check('正确率 100%', result.data?.accuracy === 100, result.data?.accuracy)
  check('解锁 FIRST_QUIZ', codes.includes('FIRST_QUIZ'), codes)
  check('解锁 QUIZ_PERFECT', codes.includes('QUIZ_PERFECT'), codes)
  const resultAgain = await post(`/quiz/sessions/${round.sessionId}/finish`, undefined, token)
  check('重复结算不重复解锁', (resultAgain.data?.newBadges ?? []).length === 0)

  console.log('\n── 积跬步：够 500 分才解锁 ──')
  const before = await get('/points/summary', token)
  check('此时还不到 500 分', before.data.total < 500, before.data.total)
  // 直接补一笔流水把总分推过 500，再触发一次判定（查一个新词条）
  await prisma.pointRecord.create({
    data: { userId, bizType: 'QUIZ_FINISH', bizId: 'seed-500', delta: 500, balanceAfter: 0 },
  })
  const trigger = await get(`/terms/${terms.data.items[1].id}`, token)
  check(
    '越过 500 分后解锁 POINTS_500',
    trigger.data?.newBadges?.some((b: any) => b.code === 'POINTS_500'),
    trigger.data?.newBadges,
  )

  console.log('\n── 我的页与报告页数字一致 ──')
  const mine = await get('/mine', token)
  const report = await get('/report/summary', token)
  const stats = report.data?.stats
  check('/mine 徽章 5 枚已解锁', mine.data?.badges?.filter((b: any) => b.unlocked).length === 5, mine.data?.badges?.filter((b: any) => b.unlocked).map((b: any) => b.code))
  check('收藏夹 20 条', mine.data?.favorites?.length === 20, mine.data?.favorites?.length)
  check('我的页 termCount = 2', mine.data?.termCount === 2, mine.data?.termCount)
  check('报告 termCount 一致', stats?.termCount === 2, stats?.termCount)
  check('报告 elegantCount 0', stats?.elegantCount === 0, stats?.elegantCount)
  check('报告闯关 1 轮', stats?.quizRounds === 1, stats?.quizRounds)
  check('报告正确率 100', stats?.quizAvgAccuracy === 100, stats?.quizAvgAccuracy)
  check('报告连续天数 1', stats?.streak === 1, stats?.streak)
  check('报告活跃天数 1', stats?.activeDays === 1, stats?.activeDays)
  check('报告徽章数 5', stats?.badgeCount === 5, stats?.badgeCount)
  check('报告总分与我的页一致', stats?.totalPoints === mine.data?.points?.total, {
    report: stats?.totalPoints,
    mine: mine.data?.points?.total,
  })

  console.log('\n── 三段文案 ──')
  const text = report.data?.text
  check('三段都非空', text?.strengths?.length > 0 && text?.improvements?.length > 0 && text?.advice?.length > 0, text)
  const allLines = [...(text?.strengths ?? []), ...(text?.improvements ?? []), ...(text?.advice ?? [])]
  check('文案无脏值', allLines.every((l: string) => !/NaN|undefined|null/.test(l)), allLines)
  check('文案提到正确率时数字对得上', allLines.some((l: string) => l.includes('100%')), allLines)

  console.log('\n── 连续 7 天：新用户 + 6 天历史 ──')
  const b = await login(PHONE_B)
  // 造前 6 天的学习记录（每天一条浏览流水）
  for (let i = 6; i >= 1; i--) {
    await prisma.pointRecord.create({
      data: {
        userId: b.userId,
        bizType: 'TERM_VIEW',
        bizId: `history-${i}`,
        delta: 2,
        balanceAfter: 0,
        createdAt: startOfDaysAgo(i),
      },
    })
  }
  const streakBefore = await get('/mine', b.token)
  check('6 天历史 + 今天未学 → streak 仍为 6', streakBefore.data?.streak === 6, streakBefore.data?.streak)
  check('今天未打卡', streakBefore.data?.checkedInToday === false)

  // 今天学一条 → 打卡
  const bTerms = await get('/terms?page=1', b.token)
  const bView = await get(`/terms/${bTerms.data.items[0].id}`, b.token)
  const cB = await post('/checkin', undefined, b.token)
  check('连续 7 天', cB.data?.streak === 7, cB.data?.streak)
  check('第 7 天额外 +20', cB.data?.streakPoints?.delta === 20, cB.data?.streakPoints)

  // 徽章是"任何写动作后"判定，所以 STREAK_7 可能在查词条那一刻就解锁了。
  // 真正要保证的是：它**只播报一次**，不能每次相关请求都弹一次"解锁徽章"。
  const announced = [
    ...(bView.data?.newBadges ?? []),
    ...(cB.data?.newBadges ?? []),
  ].map((x: any) => x.code)
  check(
    '解锁 STREAK_7 且只播报一次',
    announced.filter((c: string) => c === 'STREAK_7').length === 1,
    announced,
  )
  const streakRow = await prisma.pointRecord.findUnique({
    where: { userId_bizType_bizId: { userId: b.userId, bizType: 'STREAK_BONUS', bizId: `${todayKey}#7` } },
  })
  check('连续奖励流水带了天数', !!streakRow, `${todayKey}#7`)

  const cB2 = await post('/checkin', undefined, b.token)
  check('再打卡不再给连续奖励', cB2.data?.streakPoints === null, cB2.data)

  console.log('\n── 未登录 / 他人数据 ──')
  const anon = await get('/mine')
  check('未登录访问 /mine 返回 40100', anon.code === 40100, anon.message)
  const anonReport = await get('/report/summary')
  check('未登录访问 /report 返回 40100', anonReport.code === 40100)
  const anonCheckin = await post('/checkin')
  check('未登录打卡返回 40100', anonCheckin.code === 40100)

  console.log(`\n结果：${pass} 通过，${fail} 失败`)
  if (fail > 0) process.exitCode = 1
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
