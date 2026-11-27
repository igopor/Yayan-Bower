import 'dotenv/config'
/**
 * 阶段 10 接口冒烟测试（语言测评）。
 *
 * 覆盖：
 * - 未登录 → 40100（AI 接口不欢迎匿名，避免被当成免费代理刷 key）
 * - 四类校验失败各返回 40000 和对应中文提示（空 / 29 字 / 301 字 / 手机号）
 * - 30 字刚好通过，返回四维结果
 * - evidence 一定是原文里真实存在的片段（这是买不到的那条底线）
 * - 首次成功 +2 分；同一天第二次不再加分（duplicate），前端据此不飘字
 * - 测评算"当天学习过"：之后调打卡接口能拿到 +3（否则孩子做完测评拿不到打卡分）
 * - 测评的 2 分**不占**浏览类 20 分额度：看满 10 个词条仍能拿到 20 分
 * - 连续提交最终触发 42900（mock 通道额度放宽到 50，防答辩现场被锁）
 *
 * 跑法：先启动服务（`npm start`，已构建），再
 *   npx tsx tools/smoke-stage10.ts
 *
 * 说明：断言只看结构、数字与文案，不看模型措辞——措辞是模型的事，不该进测试。
 */
import { prisma } from '../server/src/lib/db'

const BASE = 'http://localhost:3000/api'

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

async function req(
  path: string,
  method: 'GET' | 'POST',
  body?: unknown,
  token?: string,
): Promise<Body> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers,
  })
  return (await res.json()) as Body
}

/** 与 sanitize 同一套比较口径：去标点后再判断子串 */
const strip = (s: string) => s.replace(/[\s\p{P}\p{S}]/gu, '')

const TEXT =
  '今天我和妈妈去公园放风筝。因为风很大，所以风筝一下就飞起来了。后来线缠住了，我慢慢解开。最后风筝飞得比树还高。'

async function main() {
  const phone = '136' + String(Date.now()).slice(-8)

  console.log('── 未登录 ──')
  const anon = await req('/assessment', 'POST', { text: TEXT })
  check('匿名请求被拒（40100）', anon.code === 40100, anon)

  await req('/auth/sms/send', 'POST', { phone })
  const login = await req('/auth/sms/login', 'POST', { phone, code: '123456', agreed: true })
  const token = login.data?.token as string
  check('登录成功', login.code === 0 && !!token, login)
  const user = await prisma.user.findUnique({ where: { phone }, select: { id: true } })
  check('账号已建', !!user, user?.id)

  console.log('\n── 参数校验（4 类，各 40000）──')
  const cases: Array<[string, string, string]> = [
    ['空文本', '', '请先写一段话再提交'],
    ['29 字', '好'.repeat(29), '30'],
    ['301 字', '好'.repeat(301), '300'],
    ['含手机号', '我妈妈的手机号是13800000000，她说周末带我去公园玩，还可以带上风筝。', '个人信息'],
  ]
  for (const [name, text, expectIn] of cases) {
    const r = await req('/assessment', 'POST', { text }, token)
    check(
      `${name} → 40000 且提示含「${expectIn}」`,
      r.code === 40000 && r.message.includes(expectIn),
      { code: r.code, message: r.message },
    )
  }

  console.log('\n── 首次成功 ──')
  const ok = await req('/assessment', 'POST', { text: TEXT }, token)
  const d = ok.data
  check('返回 200 业务码', ok.code === 0, ok)
  check('source 是 mock 或 model', d?.source === 'mock' || d?.source === 'model', d?.source)
  check('结果是四维', Array.isArray(d?.result?.dimensions) && d.result.dimensions.length === 4, d?.result?.dimensions?.length)

  const keys = (d?.result?.dimensions ?? []).map((x: any) => x.key)
  check(
    '四维 key 齐全且顺序固定',
    JSON.stringify(keys) === JSON.stringify(['vocabulary', 'fluency', 'richness', 'cohesion']),
    keys,
  )
  check('等级都在三档内', (d?.result?.dimensions ?? []).every((x: any) => ['很棒', '不错', '再练练'].includes(x.level)))
  check('总评非空', typeof d?.result?.overall?.summary === 'string' && d.result.overall.summary.length > 4)

  const origin = strip(TEXT)
  const evidenceOk = (d?.result?.dimensions ?? []).every(
    (x: any) => !x.evidence || origin.includes(strip(x.evidence)),
  )
  check('每个 evidence 都是原文里的片段', evidenceOk, (d?.result?.dimensions ?? []).map((x: any) => x.evidence))

  check('首次拿到 +2 分', d?.points?.granted === true && d.points.delta === 2, d?.points)

  console.log('\n── 测评算学习活动（打卡联动）──')
  const checkin = await req('/checkin', 'POST', {}, token)
  check('打卡 reason 为 ok（不是 no_activity）', checkin.data?.reason === 'ok', checkin.data?.reason)
  check('打卡拿到 +3 分', checkin.data?.points?.granted === true && checkin.data.points.delta === 3, checkin.data?.points)

  console.log('\n── 同日第二次测评不再加分 ──')
  const again = await req('/assessment', 'POST', { text: TEXT }, token)
  check('第二次仍能分析成功', again.code === 0 && !!again.data?.result, again.code)
  check('积分返回 duplicate（granted=false）', again.data?.points?.granted === false, again.data?.points)

  const balance = await prisma.pointRecord.aggregate({
    where: { userId: user!.id },
    _sum: { delta: true },
  })
  check('总分仍是 5（2 + 3），没有被重复加', (balance._sum.delta ?? 0) === 5, balance._sum.delta)

  console.log('\n── 测评的 2 分不占浏览类额度 ──')
  for (let id = 1; id <= 10; id++) {
    await req(`/terms/${id}`, 'GET', undefined, token)
  }
  const afterViews = await prisma.pointRecord.aggregate({
    where: { userId: user!.id },
    _sum: { delta: true },
  })
  // 5 + 10×2 = 25。若测评占了浏览额度，这里最多 23
  check('看满 10 个词条后总分为 25（浏览 20 分拿满）', (afterViews._sum.delta ?? 0) === 25, afterViews._sum.delta)

  console.log('\n── 每日次数上限 ──')
  let limited = 0
  let rounds = 0
  for (let i = 0; i < 60; i++) {
    rounds++
    const r = await req('/assessment', 'POST', { text: TEXT }, token)
    if (r.code === 42900) {
      limited = r.code
      check('超限提示文案正确', r.message.includes('明天再来'), r.message)
      break
    }
    if (r.code !== 0) {
      check('循环中不应出现其它错误码', false, r)
      break
    }
  }
  check(`连续提交后触发 42900（第 ${rounds} 次）`, limited === 42900, rounds)

  console.log(`\n结果：${pass} 通过，${fail} 失败`)
  await prisma.$disconnect()
  if (fail > 0) process.exit(1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
