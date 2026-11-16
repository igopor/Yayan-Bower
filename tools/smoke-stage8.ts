import 'dotenv/config'
/**
 * 阶段 8 接口冒烟测试（隐私同意 + 生产模式可达性）。
 *
 * 覆盖：
 * - 新号码不勾同意 → 被拒，且**验证码没有被核销**（同一码勾选后仍能用）
 * - 勾选后建号成功，`consent_at` 有值
 * - 已留痕的账号不传 agreed 也能登录（回归用户不必反复同意）
 * - 早期账号（consent_at 为空）不勾选被拒，勾选后补齐留痕
 * - 隐私说明页在开发（5173）与生产（3000）两种模式下都能打开
 *
 * 跑法：先启动服务（`npm run dev` 或 `npm start` + 已构建），再
 *   npx tsx tools/smoke-stage8.ts
 */
import { prisma } from '../server/src/lib/db'

const BASE = 'http://localhost:3000/api'
const WEB = process.env.SMOKE_WEB_BASE ?? 'http://localhost:5173'

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

async function post(path: string, body?: unknown, token?: string): Promise<Body> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    headers,
  })
  return (await res.json()) as Body
}

/** 每次用新号码，避免与历史数据互相干扰 */
function newPhone(prefix: string): string {
  return prefix + String(Date.now()).slice(-8)
}

async function sendCode(phone: string) {
  return post('/auth/sms/send', { phone })
}

async function main() {
  console.log('── 新号码：不勾同意 ──')
  const phoneA = newPhone('138')
  const sent = await sendCode(phoneA)
  check('验证码已下发', sent.code === 0, sent)

  const noAgree = await post('/auth/sms/login', { phone: phoneA, code: '123456' })
  check('未勾选被拒（40000）', noAgree.code === 40000, noAgree)
  check('提示语指向隐私说明', /隐私/.test(noAgree.message), noAgree.message)

  const created = await prisma.user.findUnique({ where: { phone: phoneA } })
  check('未勾选不建号', created === null, created?.id)

  console.log('\n── 同一验证码补勾选：不应被白白烧掉 ──')
  const agreed = await post('/auth/sms/login', { phone: phoneA, code: '123456', agreed: true })
  check('勾选后登录成功', agreed.code === 0, agreed)
  const userA = await prisma.user.findUnique({ where: { phone: phoneA } })
  check('建号成功', !!userA, userA?.id)
  check('consent_at 已写入', !!userA?.consentAt, userA?.consentAt)

  console.log('\n── 已留痕账号：回归用户不必反复同意 ──')
  await sendCode(phoneA)
  const again = await post('/auth/sms/login', { phone: phoneA, code: '123456' })
  check('不传 agreed 也能登录', again.code === 0, again)

  console.log('\n── 早期账号（consent_at 为空）：补一次同意 ──')
  const phoneB = newPhone('139')
  await sendCode(phoneB)
  await post('/auth/sms/login', { phone: phoneB, code: '123456', agreed: true })
  // 手动抹掉留痕，模拟先于 T8.2 建号的用户
  await prisma.user.update({ where: { phone: phoneB }, data: { consentAt: null } })
  await sendCode(phoneB)
  const legacyNo = await post('/auth/sms/login', { phone: phoneB, code: '123456' })
  check('无留痕且未勾选 → 被拒', legacyNo.code === 40000, legacyNo)
  const legacyYes = await post('/auth/sms/login', { phone: phoneB, code: '123456', agreed: true })
  check('勾选后补留痕并登录成功', legacyYes.code === 0, legacyYes)
  const userB = await prisma.user.findUnique({ where: { phone: phoneB } })
  check('补写的 consent_at 非空', !!userB?.consentAt, userB?.consentAt)

  console.log('\n── 隐私说明页可达 ──')
  const web = await fetch(`${WEB}/privacy`).catch(() => null)
  check(`${WEB} /privacy 返回 200`, web?.status === 200, web?.status)
  const html = web ? await web.text() : ''
  // 开发模式返回的是 index.html（前端渲染），生产模式同理；只校验服务端没有 404
  check('返回的是页面而不是 404', !/Cannot GET/.test(html), html.slice(0, 60))

  console.log(`\n结果：${pass} 通过，${fail} 失败`)
  await prisma.$disconnect()
  if (fail > 0) process.exit(1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
