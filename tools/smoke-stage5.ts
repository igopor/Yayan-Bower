/**
 * 阶段 5 接口冒烟测试（雅词积累）。
 *
 * 覆盖：列表分页、按雅词搜索、每日一句确定性、展开取对照 + 浏览积分幂等、
 * 与词条共用每日 20 分上限、收藏联动。
 *
 * 跑法：先启动服务，再
 *   npx tsx tools/smoke-stage5.ts
 */
const BASE = 'http://localhost:3000/api'
/** 每次全新手机号，否则第二轮必然 duplicate（积分幂等键里含用户） */
const PHONE = '137' + String(Date.now()).slice(-8)

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

async function main() {
  console.log('\n── 列表（未登录） ──')
  const list = await call('/elegant')
  check('第一页 20 条、总数 49', list.data.items.length === 20 && list.data.total === 49, {
    len: list.data?.items?.length,
    total: list.data?.total,
  })
  check('还有更多', list.data.hasMore === true)
  check('未登录收藏态为 false', list.data.items.every((i: any) => i.favorited === false))
  check(
    '列表项不含对照词（长文本只在展开时取）',
    list.data.items.every((i: any) => !('words' in i) && !('word1' in i)),
  )

  const p2 = await call('/elegant?page=2')
  const p3 = await call('/elegant?page=3')
  const ids = new Set(
    [...list.data.items, ...p2.data.items, ...p3.data.items].map((i: any) => i.termId),
  )
  check('三页合起来 49 组不重不漏', ids.size === 49, { size: ids.size })
  check('第三页 9 组且到底', p3.data.items.length === 9 && p3.data.hasMore === false, {
    len: p3.data?.items?.length,
  })

  console.log('\n── 搜索 ──')
  const byName = await call('/elegant?keyword=' + encodeURIComponent('yyds'))
  check('按热梗名搜「yyds」命中 1 组', byName.data.total === 1, byName.data?.total)

  const byWord = await call('/elegant?keyword=' + encodeURIComponent('无与伦比'))
  check(
    '按雅词搜「无与伦比」能反向找到对应热梗',
    byWord.data.total >= 1 && byWord.data.items.some((i: any) => i.name === 'yyds'),
    byWord.data?.items?.map((i: any) => i.name),
  )

  const byDef = await call('/elegant?keyword=' + encodeURIComponent('找不出一点儿毛病'))
  check('按释义搜也能命中（说明词条定义参与匹配）', byDef.data.total >= 1, byDef.data?.total)

  console.log('\n── 每日一句 ──')
  const d1 = await call('/elegant/daily-sentence')
  const d2 = await call('/elegant/daily-sentence')
  check('接口可用且不被 :termId 吃掉', d1.code === 0 && !!d1.data.content, d1)
  check('同一天两次请求返回同一条', d1.data.seq === d2.data.seq, { a: d1.data?.seq, b: d2.data?.seq })
  check('三字段齐全', !!(d1.data.source && d1.data.meaning && d1.data.content))
  check('seq 在 1..87 之间', d1.data.seq >= 1 && d1.data.seq <= 87, d1.data?.seq)

  console.log('\n── 展开取对照（未登录） ──')
  const firstId = list.data.items[0].termId
  const d = await call(`/elegant/${firstId}`)
  check('返回两条替换词且都有释义', d.data.words.length === 2 && d.data.words.every((w: any) => w.word && w.definition), d.data?.words)
  check('未登录不加分（points 为 null）', d.data.points === null)

  const missing = await call('/elegant/999999')
  check('不存在的 id 返回 40400', missing.code === 40400, missing)

  console.log('\n── 登录后：积分 ──')
  await call('/auth/sms/send', { method: 'POST', body: JSON.stringify({ phone: PHONE }) })
  const login = await call('/auth/sms/login', {
    method: 'POST',
    body: JSON.stringify({ phone: PHONE, code: '123456', agreed: true }),
  })
  const token = login.data.token as string
  check('登录成功', !!token)

  const a1 = await call(`/elegant/${firstId}`, {}, token)
  check('首次展开 +2 分', a1.data.points?.granted === true && a1.data.points?.delta === 2, a1.data?.points)

  const a2 = await call(`/elegant/${firstId}`, {}, token)
  check('同一组再展开不重复给分', a2.data.points?.reason === 'duplicate' && a2.data.points?.delta === 0, a2.data?.points)

  console.log('\n── 与词条共用每日上限 ──')
  const all = [...list.data.items, ...p2.data.items, ...p3.data.items]
  let capped = false
  let capAt = -1
  for (let i = 1; i < 12; i++) {
    const r = await call(`/elegant/${all[i].termId}`, {}, token)
    if (r.data.points?.reason === 'daily_cap') {
      capped = true
      capAt = i
      break
    }
  }
  check(`连续展开触发日上限（第 ${capAt} 组被拒）`, capped)
  const summary = await call('/points/summary', {}, token)
  check('触顶后浏览分正好 20（不多给）', summary.data.todayView === 20, summary.data)

  console.log('\n── 收藏联动 ──')
  const fav = await call(
    '/favorites',
    { method: 'POST', body: JSON.stringify({ termId: firstId }) },
    token,
  )
  check('收藏成功 +1 分', fav.data.favorited === true && fav.data.points?.delta === 1, fav.data)
  const listAfter = await call('/elegant', {}, token)
  check(
    '雅词列表能读到收藏态',
    listAfter.data.items.find((i: any) => i.termId === firstId)?.favorited === true,
  )

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
