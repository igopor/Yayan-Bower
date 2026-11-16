/**
 * 端到端验证"登录后回到原操作位置"（阶段 2 的核心设计，叠了两层弹层才是真场景）：
 *
 *   未登录 → 打开词条详情 → 点收藏 → 登录层盖在详情上 → 登录成功
 *   → 登录层自动关掉 → **详情还在，且收藏已经变成了"已收藏"**（用户不用再点一次）
 *
 * 用法：node tools/check-login-resume.mjs [url]
 * 注意：每次用新手机号，否则频控会拦（脚本按时间戳生成）。
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { mkdirSync } from 'node:fs'

const url = process.argv[2] ?? 'http://localhost:3000/terms'
const PORT = 9335
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const phone = '13' + String(Date.now()).slice(-9)
mkdirSync('.shots/chrome-profile', { recursive: true })

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    '--window-size=390,844',
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
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
})
const send = (method, params = {}) =>
  new Promise((res) => {
    const id = ++seq
    pending.set(id, res)
    ws.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.result.exceptionDetails) return { exception: r.result.exceptionDetails.text }
  return r.result.result.value
}

await new Promise((r) => ws.addEventListener('open', r, { once: true }))
await send('Page.enable')
await send('Runtime.enable')
await send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.clear()` })
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
await send('Page.navigate', { url })
await sleep(2500)

const report = await evaluate(`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const flat = (s) => (s || '').replace(/[\\n\\r\\t ]+/g, '').trim()
  const overlays = () => [...document.querySelectorAll('.fixed.inset-0')].map((el) => ({
    z: getComputedStyle(el).zIndex,
    title: flat(el.querySelector('h2') ? el.querySelector('h2').textContent : ''),
  }))
  const byText = (t) => [...document.querySelectorAll('button')].find((b) => flat(b.textContent).includes(t))
  const steps = []

  // 1. 打开详情
  const card = document.querySelector('.card button')
  if (!card) return { fatal: '找不到词条卡片' }
  card.click()
  await wait(1000)

  // 2. 未登录点收藏 → 应弹登录层
  const fav = byText('收藏')
  if (!fav) return { fatal: '详情里找不到收藏按钮' }
  fav.click()
  await wait(900)
  steps.push({ step: '点收藏', overlays: overlays() })

  // 3. 填手机号 → 拿验证码（开发模式自动填入）→ 登录
  const phoneInput = document.querySelector('#login-phone')
  if (!phoneInput) return { fatal: '登录层里找不到手机号输入框', steps }
  const setVal = (el, v) => {
    el.value = v
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  setVal(phoneInput, ${JSON.stringify(phone)})
  await wait(150)
  const sendBtn = byText('获取验证码')
  if (!sendBtn) return { fatal: '找不到获取验证码按钮', steps }
  sendBtn.click()
  await wait(1200)
  const codeInput = document.querySelector('#login-code')
  steps.push({ step: '取验证码后', codeFilled: codeInput ? codeInput.value : '' })

  const submit = document.querySelector('button[type=submit]')
  if (!submit) return { fatal: '找不到登录按钮', steps }
  submit.click()
  await wait(2000)

  // 4. 登录层应已关闭，详情仍在，收藏已生效
  const detailOverlay = document.querySelector('.fixed.inset-0')
  const favAfter = byText('收藏')
  const navPoints = document.querySelector('header') ? flat(document.querySelector('header').textContent) : ''
  steps.push({
    step: '登录后',
    overlays: overlays(),
    detailTitle: flat(detailOverlay && detailOverlay.querySelector('h2') ? detailOverlay.querySelector('h2').textContent : ''),
    favoriteButton: flat(favAfter ? favAfter.textContent : ''),
    headerText: navPoints,
    bodyOverflow: document.body.style.overflow,
  })

  return { phone: ${JSON.stringify(phone)}, steps }
})()`)

console.log(JSON.stringify(report, null, 2))
ws.close()
chrome.kill()
process.exit(0)
