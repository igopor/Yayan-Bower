/**
 * 页面截图 + 版面体检（Chrome DevTools Protocol）。
 *
 * 截图只能"看"，看不出是哪个元素撑破了视口；所以顺手把溢出元素也打出来。
 *
 * 用法：
 *   node tools/shot.mjs <url> <宽> <高> <输出png> [点击的选择器]
 * 例：
 *   node tools/shot.mjs http://localhost:3000/terms 390 844 .shots/a.png
 *   node tools/shot.mjs http://localhost:3000/terms 390 844 .shots/b.png ".card button"
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const [url = 'http://localhost:3000/', w = '390', h = '844', out = '.shots/page.png', clickSel, evalJs] =
  process.argv.slice(2)
const width = Number(w)
const height = Number(h)
const PORT = 9333
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

mkdirSync(dirname(resolve(out)), { recursive: true })

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    `--window-size=${width},${height}`,
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

await new Promise((r) => ws.addEventListener('open', r, { once: true }))
await send('Page.enable')
await send('Runtime.enable')

// 需要登录态时：把 token 预置进 localStorage，页面一加载就是已登录。
// 比在界面上走一遍验证码登录快得多，也让脚本能反复跑。
if (process.env.YYXZ_TOKEN) {
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `localStorage.setItem('yyxz_token', ${JSON.stringify(process.env.YYXZ_TOKEN)})`,
  })
}

await send('Emulation.setDeviceMetricsOverride', {
  width,
  height,
  deviceScaleFactor: 1,
  mobile: width < 600,
})
await send('Page.navigate', { url })
await sleep(2500)

if (clickSel) {
  const r = await send('Runtime.evaluate', {
    expression: `(() => { const el = document.querySelector(${JSON.stringify(clickSel)}); if (!el) return 'NOT_FOUND'; el.click(); return 'OK' })()`,
    returnByValue: true,
  })
  console.log('点击', clickSel, '→', r.result.result.value)
  await sleep(1000)
}

/** 自定义脚本：用来模拟输入、滚动等没法用 click 完成的操作 */
if (evalJs) {
  const r = await send('Runtime.evaluate', { expression: evalJs, returnByValue: true, awaitPromise: true })
  console.log('执行脚本 →', JSON.stringify(r.result.result.value ?? r.result.exceptionDetails?.text ?? ''))
  await sleep(1500)
}

const probe = `(() => {
  const vw = document.documentElement.clientWidth
  const bad = []
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) continue
    const cs = getComputedStyle(el)
    if (cs.position === 'fixed') continue
    if (r.right > vw + 1 || r.left < -1) bad.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 70), left: Math.round(r.left), right: Math.round(r.right), ox: cs.overflowX })
  }
  return JSON.stringify({ vw, sw: document.documentElement.scrollWidth, bad: bad.slice(0, 8) })
})()`
const info = JSON.parse((await send('Runtime.evaluate', { expression: probe, returnByValue: true })).result.result.value)
console.log(`视口 ${info.vw} ｜ 滚动宽 ${info.sw} ${info.sw > info.vw ? '❌ 横向溢出' : '✓ 无溢出'}`)
for (const b of info.bad) console.log(`  越界 <${b.tag}> ${b.left}→${b.right} ox:${b.ox} ${b.cls}`)

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
writeFileSync(resolve(out), Buffer.from(shot.result.data, 'base64'))
console.log('已保存', out)

ws.close()
chrome.kill()
process.exit(0)
