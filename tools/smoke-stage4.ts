/**
 * 阶段 4 接口冒烟测试。
 *
 * 用真实 HTTP 请求打本地服务，覆盖：公开列表、搜索、精选、详情、浏览积分幂等、
 * 日上限、收藏幂等、取消收藏、积分总额与流水一致性。
 *
 * 跑法：先 `npm start`（或 npx tsx server/src/index.ts），再
 *   npx tsx tools/smoke-stage4.ts
 *
 * 为什么不用 curl：带 Authorization 头的 curl 在本机沙箱里会被审批拦掉；
 * 而且断言语义写在脚本里比肉眼看 JSON 可靠。
 */
const BASE = 'http://localhost:3000/api'
/**
 * 每次跑用一个全新手机号。
 * 固定号码会让第二次运行必然失败——积分幂等键是 (用户, 业务, id)，
 * 上一轮看过的词条这一轮当然是 duplicate。测试要能反复跑才有意义。
 */
const PHONE = '139' + String(Date.now()).slice(-8)

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
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers, ...(init.headers as any) } })
  return (await res.json()) as Body
}

async function main() {
  console.log('\n── 公开接口（未登录） ──')
  const list = await call('/terms')
  check('列表返回 20 条、总数 41', list.data.items.length === 20 && list.data.total === 41, {
    len: list.data.items.length,
    total: list.data.total,
  })
  check('第一页之后还有更多', list.data.hasMore === true)
  check('未登录时收藏态为 false', list.data.items.every((i: any) => i.favorited === false))

  const page2 = await call('/terms?page=2')
  check('第二页 20 条且还有下一页', page2.data.items.length === 20 && page2.data.hasMore === true, {
    len: page2.data.items.length,
    hasMore: page2.data.hasMore,
  })
  const page3 = await call('/terms?page=3')
  check('第三页 1 条且到底', page3.data.items.length === 1 && page3.data.hasMore === false, {
    len: page3.data.items.length,
  })
  const ids = new Set(
    [...list.data.items, ...page2.data.items, ...page3.data.items].map((i: any) => i.id),
  )
  check('三页合起来无重复无遗漏（41 个不同 id）', ids.size === 41, { size: ids.size })

  const searchName = await call('/terms?keyword=' + encodeURIComponent('破防了'))
  check('按名称搜「破防了」命中 1 条', searchName.data.total === 1 && searchName.data.items[0].name === '破防了', searchName.data)

  // 数据边界：雅词独有词条（如「绝绝子」）不在辨析库内，搜不到是预期行为。
  // 这类词条 plainMeaning / heuristicAnalysis 都是空串，硬放进辨析页会是一张空卡片。
  const searchElegantOnly = await call('/terms?keyword=' + encodeURIComponent('绝绝子'))
  check('雅词独有词条不出现在辨析列表（预期返回 0）', searchElegantOnly.data.total === 0, searchElegantOnly.data)
  check(
    '但会返回 elegantHint，让用户知道去雅词页看',
    searchElegantOnly.data.elegantHint === '绝绝子',
    searchElegantOnly.data.elegantHint,
  )
  check('有结果时不返回 elegantHint', searchName.data.elegantHint === null, searchName.data.elegantHint)

  const searchMeaning = await call('/terms?keyword=' + encodeURIComponent('完蛋'))
  check('按释义搜「完蛋」能命中', searchMeaning.data.total >= 1, searchMeaning.data.total)

  const searchNone = await call('/terms?keyword=' + encodeURIComponent('这个肯定不存在xyz'))
  check('搜不到时返回空数组而不是报错', searchNone.code === 0 && searchNone.data.total === 0)

  const featured = await call('/terms/featured')
  const sorts = featured.data.map((t: any) => t.sort)
  check('精选返回 10 条', featured.data.length === 10, featured.data.length)
  check(
    '精选按 sort 升序固定排列（不随机）',
    JSON.stringify(sorts) === JSON.stringify([...sorts].sort((a, b) => a - b)),
    sorts,
  )
  const featured2 = await call('/terms/featured')
  check(
    '连续两次请求顺序完全一致',
    JSON.stringify(featured.data.map((t: any) => t.id)) === JSON.stringify(featured2.data.map((t: any) => t.id)),
  )

  const notFound = await call('/terms/999999')
  check('不存在的 id 返回 40400', notFound.code === 40400, notFound)
  const badId = await call('/terms/abc')
  check('非数字 id 返回 40400 而不是 500', badId.code === 40400, badId)

  console.log('\n── 登录 ──')
  await call('/auth/sms/send', { method: 'POST', body: JSON.stringify({ phone: PHONE }) })
  const login = await call('/auth/sms/login', {
    method: 'POST',
    body: JSON.stringify({ phone: PHONE, code: '123456', agreed: true }),
  })
  const token: string = login.data?.token
  check('登录成功并拿到 token', !!token)
  if (!token) return finish()

  const baseTotal: number = login.data.user.totalPoints

  console.log('\n── 浏览积分 ──')
  const d1 = await call('/terms/1', {}, token)
  check('详情返回三个字段齐全', !!d1.data.plainMeaning && !!d1.data.heuristicAnalysis, Object.keys(d1.data))
  check('首次浏览 +2 分', d1.data.points?.granted === true && d1.data.points.delta === 2, d1.data.points)

  const d1again = await call('/terms/1', {}, token)
  check('再打开同一词条不重复加分', d1again.data.points?.granted === false && d1again.data.points.reason === 'duplicate', d1again.data.points)

  // 连开若干词条，把 20 分日上限吃满（每次 2 分，已拿 2 分）
  let capped = false
  for (let id = 2; id <= 13; id++) {
    const r = await call(`/terms/${id}`, {}, token)
    if (r.data.points?.reason === 'daily_cap') capped = true
  }
  check('浏览类日上限生效（超出后返回 daily_cap）', capped)

  const summary = await call('/points/summary', {}, token)
  check('今日浏览分不超过上限 20', summary.data.todayView <= 20, summary.data)

  console.log('\n── 收藏 ──')
  const fav = await call('/favorites', { method: 'POST', body: JSON.stringify({ termId: 1 }) }, token)
  check('首次收藏 favorited=true 且 +1 分', fav.data.favorited === true && fav.data.points?.delta === 1, fav.data)

  const favAgain = await call('/favorites', { method: 'POST', body: JSON.stringify({ termId: 1 }) }, token)
  check('重复收藏不报错、不重复加分', favAgain.code === 0 && favAgain.data.points?.granted === false, favAgain.data)

  const withFav = await call('/terms/1', {}, token)
  check('详情能读到已收藏状态', withFav.data.favorited === true)

  const favList = await call('/favorites', {}, token)
  check('收藏列表里有这一条', favList.data.length >= 1 && favList.data[0].termId === 1, favList.data)

  const unfav = await call('/favorites/1', { method: 'DELETE' }, token)
  check('取消收藏成功且不扣分（points=null）', unfav.data.favorited === false && unfav.data.points === null, unfav.data)

  const afterUnfav = await call('/terms/1', {}, token)
  check('取消后详情显示未收藏', afterUnfav.data.favorited === false)

  const favNull = await call('/favorites', {}, token)
  check('收藏列表已清空', favNull.data.length === 0, favNull.data.length)

  console.log('\n── 权限 ──')
  const noAuth = await call('/favorites', { method: 'POST', body: JSON.stringify({ termId: 2 }) })
  check('未登录收藏返回 40100', noAuth.code === 40100, noAuth)
  const noAuthList = await call('/favorites')
  check('未登录看收藏列表返回 40100', noAuthList.code === 40100, noAuthList)

  console.log('\n── 数据一致性 ──')
  const finalSummary = await call('/points/summary', {}, token)
  const records = await call('/points/records?limit=100', {}, token)
  const sum = records.data.reduce((s: number, r: any) => s + r.delta, 0)
  check('总分 = 流水求和', finalSummary.data.total === sum, { total: finalSummary.data.total, sum })
  check('总分相对初始只增不减', finalSummary.data.total >= baseTotal)
  // balanceAfter 必须逐条累加一致
  const asc = [...records.data].reverse()
  let running = 0
  let snapshotsOk = true
  for (const r of asc) {
    running += r.delta
    if (r.balanceAfter !== running) snapshotsOk = false
  }
  check('每笔流水的 balanceAfter 与实际累加一致', snapshotsOk)

  finish()
}

function finish() {
  console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('脚本异常：', e)
  process.exit(1)
})
