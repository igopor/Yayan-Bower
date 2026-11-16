import 'dotenv/config'
/**
 * 阶段 6 接口冒烟测试（情景挑战）。
 *
 * 覆盖：开轮抽题（不含答案）、左右交换、服务端计时与超时、重复提交幂等、
 * 跳题/越序拒绝、结算与分档、积分只发一次、他人会话拿不到。
 *
 * 判分正确性不能靠前端"看对不对"，所以这里直接连库读出 correctOption 和
 * displaySwap，自己算出"该点哪个"，再和接口返回比对 —— 相当于用一个独立实现校验服务端。
 *
 * 跑法：先启动服务，再
 *   npx tsx tools/smoke-stage6.ts
 */
import { prisma } from '../server/src/lib/db'
import { toDisplayPick } from '../server/src/services/quiz'
import { QUIZ_SIZE } from '../shared/index'

const BASE = 'http://localhost:3000/api'
/** 每次全新手机号，避免积分幂等键命中上一轮的数据 */
const PHONE = '138' + String(Date.now()).slice(-8)
const OTHER_PHONE = '139' + String(Date.now()).slice(-8)

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

async function login(phone: string): Promise<string> {
  await post('/auth/sms/send', { phone })
  const r = await post('/auth/sms/login', { phone, code: '123456', agreed: true })
  return r.data.token as string
}

/** 从库里取这一轮的"正确答案在屏幕上的位置"，绕过接口 —— 接口本来就不给答案 */
async function screenAnswerFor(sessionId: number, seq: number) {
  const item = await prisma.quizSessionItem.findFirst({ where: { sessionId, seq } })
  if (!item) throw new Error(`会话 ${sessionId} 没有第 ${seq} 题`)
  const q = await prisma.quizQuestion.findUnique({ where: { id: item.questionId } })
  if (!q) throw new Error(`题库里没有 ${item.questionId}`)
  return {
    correctOption: q.correctOption as 'A' | 'B',
    displaySwap: item.displaySwap,
    correctPick: toDisplayPick(q.correctOption as 'A' | 'B', item.displaySwap),
    wrongPick: toDisplayPick(q.correctOption as 'A' | 'B', item.displaySwap) === 'A' ? 'B' : 'A',
  }
}

/** 全对一轮，返回 sessionId 与结算结果 */
async function playPerfectRound(token: string) {
  const s = await post('/quiz/sessions', undefined, token)
  const sessionId = s.data.sessionId as number
  for (let seq = 1; seq <= s.data.total; seq++) {
    await post(`/quiz/sessions/${sessionId}/start`, { seq }, token)
    const { correctPick } = await screenAnswerFor(sessionId, seq)
    await post(`/quiz/sessions/${sessionId}/answers`, { seq, pick: correctPick }, token)
  }
  const r = await post(`/quiz/sessions/${sessionId}/finish`, undefined, token)
  return { sessionId, result: r.data }
}

async function main() {
  console.log('\n── 未登录 ──')
  const anon = await post('/quiz/sessions')
  check('未登录开轮返回 40100', anon.code === 40100, anon)

  const token = await login(PHONE)
  check('登录成功', !!token)

  console.log('\n── 开轮：抽题 ──')
  const s1 = await post('/quiz/sessions', undefined, token)
  check(`一轮 ${QUIZ_SIZE} 题`, s1.data.total === QUIZ_SIZE, s1.data?.total)
  check('题数与题目数组一致', s1.data.questions.length === QUIZ_SIZE, s1.data?.questions?.length)
  check(
    'seq 从 1 连续到总题数',
    s1.data.questions.every((q: any, i: number) => q.seq === i + 1),
  )
  check(
    '同一轮内题目不重复',
    new Set(s1.data.questions.map((q: any) => q.stem)).size === s1.data.total,
  )
  const raw = JSON.stringify(s1.data)
  check(
    '响应体不含任何答案字段',
    !/correctOption|correct_option|isCorrect|explanation/.test(raw),
    raw.slice(0, 200),
  )
  check(
    '每题两个非空选项',
    s1.data.questions.every(
      (q: any) => q.options.length === 2 && q.options[0] && q.options[1],
    ),
  )
  check('返回了每题限时，前端不用写死', s1.data.seconds === 15, s1.data?.seconds)

  console.log('\n── 抽题随机性与选项交换 ──')
  const stemSets: string[] = []
  let swapTrue = 0
  let swapFalse = 0
  stemSets.push([...s1.data.questions.map((q: any) => q.stem)].sort().join('|'))
  for (const q of s1.data.questions) q.displaySwap ? swapTrue++ : swapFalse++
  for (let i = 0; i < 4; i++) {
    const s = await post('/quiz/sessions', undefined, token)
    stemSets.push([...s.data.questions.map((q: any) => q.stem)].sort().join('|'))
    for (const q of s.data.questions) q.displaySwap ? swapTrue++ : swapFalse++
  }
  check('连开 5 轮，题目组合不是同一套', new Set(stemSets).size > 1, { kinds: new Set(stemSets).size })
  check('左右交换两种取值都出现过（50 题里）', swapTrue > 0 && swapFalse > 0, { swapTrue, swapFalse })

  console.log('\n── 全对一轮：判分 / 计时 / 结算 ──')
  const { sessionId, result } = await playPerfectRound(token)
  check('全对 100%', result.accuracy === 100, result)
  check('答对数 = 总题数', result.correctCount === result.total, result?.correctCount)
  check('分档为 great', result.tier === 'great', result?.tier)
  check('评语非空且不含具体数字', !!result.comment && !/\d/.test(result.comment), result?.comment)
  check('完成一轮 +10', result.finishPoints?.delta === 10, result?.finishPoints)
  check('全对额外 +5', result.perfectPoints?.delta === 5, result?.perfectPoints)
  check('本轮到手 15 分', result.totalEarned === 15, result?.totalEarned)

  const again = await post(`/quiz/sessions/${sessionId}/finish`, undefined, token)
  check('重复结算返回同一结果', again.data.accuracy === 100 && again.data.correctCount === 10, again.data)
  check('重复结算不再加分（finish 变 duplicate）', again.data.finishPoints?.reason === 'duplicate', again.data?.finishPoints)
  check('重复结算后本轮到手仍是 15（从流水求和）', again.data.totalEarned === 15, again.data?.totalEarned)

  const sessionPoints = await prisma.pointRecord.count({
    where: { bizId: String(sessionId), bizType: { in: ['QUIZ_FINISH', 'QUIZ_PERFECT'] } },
  })
  check('库里只有 2 条本轮积分流水（没重复发）', sessionPoints === 2, { sessionPoints })

  console.log('\n── 判分与交换一致性（逐题核对） ──')
  const items = await prisma.quizSessionItem.findMany({ where: { sessionId }, orderBy: { seq: 'asc' } })
  let consistent = true
  for (const it of items) {
    if (it.chosen === null || it.isCorrect !== true) {
      consistent = false
      break
    }
    const q = await prisma.quizQuestion.findUnique({ where: { id: it.questionId } })
    // 库里存的 chosen 必须是**题库原始位置**，而不是屏幕位置：
    // 存屏幕位置的话，"这题多数人掉进哪个坑"的统计要再套一遍 displaySwap 才对
    if (!q || it.chosen !== q.correctOption) {
      consistent = false
      break
    }
  }
  check('10 题的 chosen 都记成原始位置且与答案一致', consistent)

  console.log('\n── 全错 + 超时 + 未答一轮 ──')
  const s2 = await post('/quiz/sessions', undefined, token)
  const sid2 = s2.data.sessionId as number
  for (let seq = 1; seq <= 8; seq++) {
    await post(`/quiz/sessions/${sid2}/start`, { seq }, token)
    const { wrongPick } = await screenAnswerFor(sid2, seq)
    const a = await post(`/quiz/sessions/${sid2}/answers`, { seq, pick: wrongPick }, token)
    if (seq === 1) check('答错判 false', a.data.isCorrect === false, a.data)
  }
  // 第 9 题：把服务端计时起点往前挪 20 秒，模拟"用户想了 20 秒才点"
  await prisma.quizSessionItem.updateMany({
    where: { sessionId: sid2, seq: 9 },
    data: { servedAt: new Date(Date.now() - 20_000) },
  })
  const restart = await post(`/quiz/sessions/${sid2}/start`, { seq: 9 }, token)
  check(
    '重复 start 不会重置计时（返回的仍是 20 秒前那个起点）',
    restart.data.elapsedMs >= 19_000,
    restart.data,
  )
  const nine = await screenAnswerFor(sid2, 9)
  const timeout = await post(
    `/quiz/sessions/${sid2}/answers`,
    { seq: 9, pick: nine.correctPick },
    token,
  )
  check('超过 16 秒即使点对也判错', timeout.data.isCorrect === false, timeout.data)
  check('并标记 timedOut', timeout.data.timedOut === true, timeout.data)

  const r2 = await post(`/quiz/sessions/${sid2}/finish`, undefined, token)
  check('答了 9 题、对 0 题', r2.data.answeredCount === 9 && r2.data.correctCount === 0, r2.data)
  check('正确率 0、分档 keep', r2.data.accuracy === 0 && r2.data.tier === 'keep', r2.data)
  check('未达标没有额外加分', r2.data.perfectPoints === null, r2.data?.perfectPoints)
  check('完成一轮仍然 +10', r2.data.totalEarned === 10, r2.data?.totalEarned)

  console.log('\n── 顺序与幂等 ──')
  const s3 = await post('/quiz/sessions', undefined, token)
  const sid3 = s3.data.sessionId as number

  const skipStart = await post(`/quiz/sessions/${sid3}/start`, { seq: 3 }, token)
  check('跳着进第 3 题被拒', skipStart.code === 40000, skipStart)

  const beforeStart = await post(`/quiz/sessions/${sid3}/answers`, { seq: 1, pick: 'A' }, token)
  check('没进题就作答被拒', beforeStart.code === 40000, beforeStart)

  await post(`/quiz/sessions/${sid3}/start`, { seq: 1 }, token)
  const first = await screenAnswerFor(sid3, 1)
  const a1 = await post(`/quiz/sessions/${sid3}/answers`, { seq: 1, pick: first.correctPick }, token)
  const a1again = await post(
    `/quiz/sessions/${sid3}/answers`,
    { seq: 1, pick: first.correctPick },
    token,
  )
  check('第一次是正常判分', a1.data.replayed === false, a1.data)
  check('第二次是回放，重新标记为 replayed', a1again.data.replayed === true, a1again.data)
  check(
    '回放的结论与第一次一致',
    a1again.data.isCorrect === a1.data.isCorrect &&
      a1again.data.correctPick === a1.data.correctPick,
    { first: a1.data, again: a1again.data },
  )
  check('回放不会把已答的题算成两次', (await prisma.quizSessionItem.count({
    where: { sessionId: sid3, answeredAt: { not: null } },
  })) === 1)

  const timeoutAnswer = await post(
    `/quiz/sessions/${sid3}/answers`,
    { seq: 2, pick: null },
    token,
  )
  check('未进第 2 题就交空卷被拒', timeoutAnswer.code === 40000, timeoutAnswer)

  console.log('\n── 结算边界 ──')
  const s4 = await post('/quiz/sessions', undefined, token)
  const zero = await post(`/quiz/sessions/${s4.data.sessionId}/finish`, undefined, token)
  check('一题没答就结算被拒', zero.code === 40000, zero)

  const other = await login(OTHER_PHONE)
  const stolen = await post(`/quiz/sessions/${sid3}/finish`, undefined, other)
  check('别人的会话拿不到（按不存在处理）', stolen.code === 40400, stolen)

  console.log('\n── 旧会话自动作废 ──')
  // 上一段开的 s4 已经在"一题没答就结算"里用过；这里再单独开一轮来观察状态变化，
  // 否则"作废前"读到的是被别人开轮顶掉的 abandoned
  const s5 = await post('/quiz/sessions', undefined, token)
  const sid5 = s5.data.sessionId as number
  const beforeNew = await prisma.quizSession.findUnique({ where: { id: sid5 } })
  check('新开的一轮状态是 playing', beforeNew?.status === 'playing', beforeNew?.status)

  await post('/quiz/sessions', undefined, token)
  const afterNew = await prisma.quizSession.findUnique({ where: { id: sid5 } })
  check('开新轮后上一轮标记 abandoned', afterNew?.status === 'abandoned', afterNew?.status)

  const playAbandoned = await post(`/quiz/sessions/${sid3}/finish`, undefined, token)
  check('作废的轮次不能结算', playAbandoned.code === 40000, playAbandoned)

  const summary = await call('/points/summary', {}, token)
  check('积分总额 = 15 + 10 = 25', summary.data.total === 25, summary.data)

  await prisma.user.deleteMany({ where: { phone: { in: [PHONE, OTHER_PHONE] } } })

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
  if (fail > 0) process.exit(1)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
