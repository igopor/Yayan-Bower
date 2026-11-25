import 'dotenv/config'
/**
 * 阶段 9 接口冒烟测试（AI 小结）。
 *
 * 覆盖：
 * - 未登录 → 401（AI 接口不欢迎匿名，避免被人当成免费代理刷 key）
 * - 零数据用户也能拿到小结，且**不提正确率**（这类自动文案最典型的翻车点）
 * - 有浏览记录时，小结引用了真实数字
 * - 第二次请求命中当天缓存（不重复调用模型 = 不重复花钱）
 * - 15 秒内点「重新生成」仍走缓存（防连点）
 * - 缓存确实落库，一天只有一行
 * - 小结里不出现手机号（只发聚合数字这条底线）
 *
 * 跑法：先启动服务（`npm start`，已构建），再
 *   npx tsx tools/smoke-stage9.ts
 *
 * 注意：脚本用的是当前 .env 里的 AI 通道。默认 mock（不联网），
 * 断言只检查结构与数字，不检查具体措辞——措辞是模型的事，不该进测试。
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

async function main() {
  const phone = '137' + String(Date.now()).slice(-8)

  console.log('── 未登录 ──')
  const anon = await req('/report/ai-summary', 'POST', {})
  check('匿名请求被拒（40100）', anon.code === 40100, anon)

  console.log('\n── 新账号（零数据）──')
  await req('/auth/sms/send', 'POST', { phone })
  const login = await req('/auth/sms/login', 'POST', { phone, code: '123456', agreed: true })
  const token = login.data?.token as string
  check('登录成功', login.code === 0 && !!token, login)

  const empty = await req('/report/ai-summary', 'POST', {}, token)
  const e = empty.data
  check('接口返回 200 业务码', empty.code === 0, empty)
  check('通道可用（source 不是 unavailable）', e?.source === 'mock' || e?.source === 'model', e?.source)
  check('总评非空', typeof e?.summary === 'string' && e.summary.length > 4, e?.summary)
  check('建议是数组且不超过 3 条', Array.isArray(e?.suggestions) && e.suggestions.length <= 3, e?.suggestions)
  check('零闯关时**不提正确率**', !/正确率/.test(e?.summary ?? ''), e?.summary)

  console.log('\n── 有浏览记录后 ──')
  for (const id of [1, 2, 3]) {
    await req(`/terms/${id}`, 'GET', undefined, token)
  }
  const user = await prisma.user.findUnique({ where: { phone }, select: { id: true } })
  check('账号已建', !!user, user?.id)
  await prisma.aiSummary.deleteMany({ where: { userId: user!.id } })

  const withData = await req('/report/ai-summary', 'POST', {}, token)
  const w = withData.data
  check('引用了真实浏览数（3 个热梗）', /3\s*个热梗/.test(w?.summary ?? ''), w?.summary)
  check('不是缓存（首生成）', w?.cached === false, w?.cached)
  check('小结里没有手机号', !(w?.summary ?? '').includes(phone), w?.summary)

  console.log('\n── 缓存与节流 ──')
  const second = await req('/report/ai-summary', 'POST', {}, token)
  check('第二次命中缓存', second.data?.cached === true, second.data?.cached)
  check('缓存内容与首次一致', second.data?.summary === w?.summary)

  const forced = await req('/report/ai-summary', 'POST', { force: true }, token)
  check('15 秒内重生成仍走缓存（防连点）', forced.data?.cached === true, forced.data?.cached)

  const rows = await prisma.aiSummary.findMany({ where: { userId: user!.id } })
  check('库里一天只有一行', rows.length === 1, rows.length)
  check('缓存记录了数据指纹', (rows[0]?.signature ?? '').length > 0, rows[0]?.signature)
  check('缓存记录了通道/model', (rows[0]?.model ?? '').length > 0, rows[0]?.model)

  console.log('\n── 数据变化后（10 分钟节流内）──')
  await req('/terms/4', 'GET', undefined, token)
  const afterChange = await req('/report/ai-summary', 'POST', {}, token)
  check('10 分钟内不重新生成（节流生效）', afterChange.data?.cached === true, afterChange.data?.cached)

  console.log(`\n结果：${pass} 通过，${fail} 失败`)
  await prisma.$disconnect()
  if (fail > 0) process.exit(1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
