import { toPng } from 'html-to-image'

/**
 * 把页面上一块区域导成 PNG。
 *
 * 四个决定：
 *
 * 1. **pixelRatio 2** —— 手机上 1x 的图在微信里放大就糊，2x 是"能看清又好传"的平衡点。
 *
 * 2. **`skipFonts: true`，不内联字体。**
 *    方案里写的是"中文字体内联"，实际做下来内联反而是风险来源：
 *    内联要走 base64 塞进 SVG，一旦字体文件缺失或编码不对，导出的图就是方块字。
 *    本站全站用系统字体栈（没有 @font-face），导出时浏览器用的是本机字体，
 *    中文天然不会乱码，也不需要为了一张报告图下载几百 KB 字体。
 *    代价：家长手机上没有的字体（比如某些艺术字）不会出现在图里——本站没用艺术字。
 *
 * 3. **只在手机上走系统分享面板，桌面端一律直接下载。**
 *    一开始写的是"能分享就分享"，结果 Windows 上的 Chrome 也支持
 *    `navigator.share({ files })`，桌面端点一下弹出的是一张系统分享面板——
 *    用户的预期是文件存到「下载」文件夹，这是 bug 不是特性。
 *    判断依据必须看设备类型，不能看 `canShare` 的返回值。
 *
 * 4. **取消分享不算失败。** 用户自己关掉面板（`AbortError`）时不要再补一个下载动作。
 */
export type ExportResult = 'shared' | 'downloaded'

/**
 * 是不是手机/平板。
 *
 * 优先用 UA-CH 的 `mobile` 字段（Chromium 系浏览器都有），
 * 老浏览器退回 UA 正则；iPadOS 13 之后 UA 伪装成 Macintosh，
 * 但触点数 > 1，用这个特征认出来。
 */
function isMobileLike(): boolean {
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData
  if (uaData && typeof uaData.mobile === 'boolean') return uaData.mobile

  const ua = navigator.userAgent
  if (/Android|iPhone|iPad|iPod|Mobile|HarmonyOS|MicroMessenger/i.test(ua)) return true
  // iPadOS 13+：UA 写的是 Macintosh，但有多点触控
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true
  return false
}

export async function exportElementAsPng(node: HTMLElement, filename: string): Promise<ExportResult> {
  const dataUrl = await toPng(node, {
    pixelRatio: 2,
    // 卡片圆角外的底色，和页面一致；不设的话透明边在微信里会变成黑底
    backgroundColor: '#FAF7F2',
    skipFonts: true,
    cacheBust: true,
  })

  // 桌面端直接下载：这是用户预期，也顺手避开系统分享面板在某些 Windows 版本上的卡顿
  if (!isMobileLike()) {
    triggerDownload(dataUrl, filename)
    return 'downloaded'
  }

  // 手机/平板：优先走分享面板，iOS Safari 上"存储图像"才是进相册的正路
  const blob = await (await fetch(dataUrl)).blob()
  const file = new File([blob], filename, { type: 'image/png' })

  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean }
  if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: filename })
      return 'shared'
    } catch (e) {
      // AbortError = 用户自己关掉了分享面板，这不是失败，不要再补一个下载动作吓人
      if ((e as Error).name === 'AbortError') return 'shared'
      // 其它错误（比如系统不允许）继续走下载
    }
  }

  triggerDownload(dataUrl, filename)
  return 'downloaded'
}

function triggerDownload(dataUrl: string, filename: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  // 不要 appendChild 后立刻 remove：刚点完就把节点摘掉，Chrome 会把还没写完的下载标成 canceled。
  // `a.click()` 对游离节点同样有效（Chrome / Edge / Safari 都支持），所以干脆不插进文档。
  a.click()
}

/** 文件名带日期：家长存下来一眼知道是哪天的报告 */
export function reportFileName(nickname: string): string {
  const d = new Date()
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n))
  return `雅言小筑-${nickname}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.png`
}
