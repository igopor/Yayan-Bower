/**
 * 全站走查（Chrome DevTools Protocol）。
 *
 * 比一张张截图快：一个浏览器实例把所有页面在手机/桌面两档都过一遍，并自动检查
 *   1. 横向溢出（scrollWidth > clientWidth）
 *   2. 控制台报错与请求失败（白屏类问题的第一现场）
 *   3. 触控区太小（< 32px 的按钮，手机上点不中）
 *   4. 死链（页面上所有站内 href 逐个 GET）
 *   5. 固定底栏是否遮住正文最后一行
 *
 * 用法：
 *   node tools/check-pages.mjs                       # 打 http://localhost:3000（生产单端口）
 *   BASE=http://localhost:5173 node tools/check-pages.mjs
 *   YYXZ_TOKEN=xxx node tools/check-pages.mjs        # 带登录态跑「我的 / 报告」
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { writeFileSync, mkdirSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:3000'
const PORT = 9337
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT_DIR = '.shots/s8'
mkdirSync(OUT_DIR, { recursive: true })

const ROUTES = [
  { path: '/', name: 'home', label: '首页' },
  { path: '/terms', name: 'terms', label: '热梗辨析' },
  { path: '/elegant', name: 'elegant', label: '雅词积累' },
  { path: '/quiz', name: 'quiz', label: '情景挑战入口' },
  { path: '/report', name: 'report', label: '家校反馈' },
  { path: '/assessment', name: 'assessment', label: '语言测评' },
  { path: '/mine', name: 'mine', label: '我的' },
  { path: '/privacy', name: 'privacy', label: '隐私说明' },
  { path: '/no-such-page', name: '404', label: '不存在页' },
]

const SIZES = [
  { w: 375, h: 812, tag: 'm' },
  { w: 1440, h: 900, tag: 'd' },
]

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=' + process.cwd() + '/.shots/chrome-profile',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

async function firstPage() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const p = list.find((t) => t.type === 'page')
      if (p) return p
    } catch {
      /* 未就绪 */
    }
    await sleep(250)
  }
  throw new Error('Chrome 调试端口未就绪')
}

const page = await firstPage()
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
/** 每次导航前清空，用来收集这一页的报错 */
let errors = []
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
    return
  }
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push('异常: ' + (m.params.exceptionDetails?.exception?.description ?? '').split('\n')[0])
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errors.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 120))
  }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    errors.push('log: ' + m.params.entry.text.slice(0, 120))
  }
  if (m.method === 'Network.loadingFailed' && !m.params.canceled) {
    errors.push('请求失败: ' + m.params.errorText)
  }
})

const send = (method, params = {}) =>
  new Promise((res) => {
    const id = ++seq
    pending.set(id, res)
    ws.send(JSON.stringify({ id, method, params }))
  })

await new Promise((r) => ws.addEventListener('open', r, { once: true }))
await send('Page.enable')
await send('Runtime.enable')
await send('Log.enable')
await send('Network.enable')

if (process.env.YYXZ_TOKEN) {
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `localStorage.setItem('yyxz_token', ${JSON.stringify(process.env.YYXZ_TOKEN)})`,
  })
}

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text)
  return r.result.result.value
}

const PROBE = `(() => {
  const vw = document.documentElement.clientWidth
  const sw = document.documentElement.scrollWidth
  const bad = []
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) continue
    const cs = getComputedStyle(el)
    if (cs.position === 'fixed' || cs.overflowX !== 'visible') continue
    // 横向滚动容器（如精选横滑）内部越界是设计如此，跳过
    let p = el.parentElement
    let inScroller = false
    while (p && p !== document.body) {
      if (getComputedStyle(p).overflowX !== 'visible') { inScroller = true; break }
      p = p.parentElement
    }
    if (inScroller) continue
    if (r.right > vw + 1 || r.left < -1) bad.push(el.tagName.toLowerCase() + ' ' + String(el.className).slice(0, 60))
  }
  // 触控区：手机上按钮太矮点不中
  const tiny = []
  if (vw < 600) {
    for (const el of document.querySelectorAll('button, a[href], input, [role=button]')) {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) continue
      if (getComputedStyle(el).display === 'none') continue
      if (r.height < 28) tiny.push(el.tagName.toLowerCase() + ' ' + Math.round(r.height) + 'px "' + (el.innerText || '').trim().slice(0, 12) + '"')
    }
  }
  // 固定底栏遮挡：正文最后一段与底栏矩形是否相交
  let covered = false
  const bar = [...document.querySelectorAll('body *')].find(el => {
    const cs = getComputedStyle(el)
    return cs.position === 'fixed' && parseInt(cs.bottom) <= 1 && el.getBoundingClientRect().height > 20
  })
  if (bar) {
    const barTop = bar.getBoundingClientRect().top
    const main = document.querySelector('main')
    if (main) {
      const last = main.lastElementChild
      if (last && last.getBoundingClientRect().bottom > barTop + 1) covered = true
    }
  }
  return JSON.stringify({
    vw, sw, bad: bad.slice(0, 5), tiny: tiny.slice(0, 6), covered,
    title: document.title,
    textLen: (document.querySelector('main')?.innerText || '').trim().length,
    links: [...new Set([...document.querySelectorAll('a[href^="/"]')].map(a => a.getAttribute('href')))],
  })
})()`

const results = []
const allLinks = new Set()

for (const size of SIZES) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: size.w,
    height: size.h,
    deviceScaleFactor: 1,
    mobile: size.w < 600,
  })

  for (const route of ROUTES) {
    errors = []
    await send('Page.navigate', { url: BASE + route.path })
    await sleep(1600)
    // 先滚到底再测"底栏是否遮住正文"，否则长页面里未进入视口的内容会被误判
    await evaluate('window.scrollTo(0, document.body.scrollHeight)')
    await sleep(400)
    let info
    try {
      info = JSON.parse(await evaluate(PROBE))
    } catch (e) {
      info = { error: e.message, vw: size.w, sw: size.w, bad: [], tiny: [], links: [], textLen: 0 }
    }
    info.links?.forEach((l) => allLinks.add(l))
    const overflow = info.sw > info.vw
    results.push({ route, size, info, overflow, errors: [...errors] })

    await evaluate('window.scrollTo(0, 0)')
    await sleep(250)
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    writeFileSync(`${OUT_DIR}/${route.name}-${size.tag}.png`, Buffer.from(shot.result.data, 'base64'))
  }
}

// ── 死链检查：站内 href 逐个 GET ──
const dead = []
for (const href of allLinks) {
  const res = await fetch(BASE + href, { redirect: 'manual' }).catch(() => null)
  if (!res || res.status >= 400) dead.push(`${href} → ${res ? res.status : 'ERR'}`)
}

// ── 汇总输出 ──
let issues = 0
console.log(`\n全站走查　${BASE}\n`)
for (const r of results) {
  const problems = []
  if (r.overflow) problems.push(`横向溢出 ${r.info.sw}>${r.info.vw}`)
  if (r.info.bad?.length) problems.push(`越界元素 ${r.info.bad.length}`)
  if (r.info.tiny?.length) problems.push(`触控区过小 ${r.info.tiny.length}`)
  if (r.info.covered) problems.push('底栏遮住正文')
  if (r.info.textLen !== undefined && r.info.textLen < 20) problems.push(`内容过少 ${r.info.textLen} 字`)
  if (r.errors.length) problems.push(`报错 ${r.errors.length}: ${r.errors[0]}`)
  if (problems.length) issues++
  const mark = problems.length ? '❌' : '✓'
  console.log(`${mark} ${r.size.tag === 'm' ? '375' : '1440'} ${r.route.path.padEnd(16)} ${r.route.label}${problems.length ? '　' + problems.join('；') : ''}`)
  if (r.info.tiny?.length) for (const t of r.info.tiny) console.log(`     触控区 ${t}`)
  if (r.info.bad?.length) for (const b of r.info.bad) console.log(`     越界 ${b}`)
}

console.log(`\n死链检查：${allLinks.size} 个站内链接，${dead.length ? '❌ ' + dead.join('、') : '✓ 全部可达'}`)
if (dead.length) issues++
console.log(`\n截图：${OUT_DIR}/　｜　问题页：${issues} 处`)

ws.close()
chrome.kill()
process.exit(issues > 0 ? 1 : 0)
