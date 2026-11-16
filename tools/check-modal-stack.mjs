/**
 * 弹层叠放验证：未登录时打开词条详情 → 点收藏 → 应该弹出登录层且**盖在详情之上**。
 *
 * 之前两层都用 z-50，靠 DOM 顺序决定谁在上，结果登录层被压在详情下面。
 * 这个脚本不靠肉眼判断，直接量：两层各自的 computed z-index、视口正中点上
 * 实际命中的元素、以及 body 是否仍被锁住。
 *
 * 用法：node tools/check-modal-stack.mjs [url]
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { mkdirSync } from 'node:fs'

const url = process.argv[2] ?? 'http://localhost:3000/terms'
const PORT = 9334
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
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
  return r.result.result.value
}

await new Promise((r) => ws.addEventListener('open', r, { once: true }))
await send('Page.enable')
await send('Runtime.enable')

// 必须保证未登录，否则不会弹登录层
await send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.clear()` })
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
await send('Page.navigate', { url })
await sleep(2500)

const report = await evaluate(`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const flat = (s) => (s || '').replace(/[\\n\\r\\t ]+/g, '').slice(0, 26)
  const overlays = () => [...document.querySelectorAll('.fixed.inset-0')].map((el) => ({
    z: getComputedStyle(el).zIndex,
    title: flat(el.querySelector('h2') ? el.querySelector('h2').textContent : ''),
    head: flat(el.textContent),
  }))

  const cardBtn = document.querySelector('.card button')
  if (!cardBtn) return { fatal: '找不到词条卡片' }
  cardBtn.click()
  await wait(1000)
  const afterOpen = { step: '打开词条详情', overlays: overlays(), bodyOverflow: document.body.style.overflow }

  const favBtn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('收藏'))
  if (!favBtn) return { fatal: '详情里找不到收藏按钮', afterOpen }
  favBtn.click()
  await wait(1400)

  const hit = document.elementFromPoint(Math.round(innerWidth / 2), Math.round(innerHeight / 2))
  const hitOverlay = hit && hit.closest ? hit.closest('.fixed.inset-0') : null
  const afterLogin = {
    step: '点收藏后',
    overlays: overlays(),
    centerHitText: flat(hit ? hit.textContent : ''),
    centerHitOverlayTitle: flat(hitOverlay ? (hitOverlay.querySelector('h2') || {}).textContent : ''),
    bodyOverflow: document.body.style.overflow,
  }

  // 只按一次 Esc：应该只关掉最上层，详情仍在
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  await wait(900)
  const afterEsc = { step: '按一次 Esc 后', overlays: overlays(), bodyOverflow: document.body.style.overflow }

  return { afterOpen, afterLogin, afterEsc }
})()`)

console.log(JSON.stringify(report, null, 2))
ws.close()
chrome.kill()
process.exit(0)
