/**
 * 弹层的叠放顺序与背景滚动锁。
 *
 * 为什么需要这个：弹层可以叠加——词条详情里点收藏，会再弹一个登录层。
 * 两层都用 `z-50` 时，谁在上面**不取决于谁后打开**，而取决于谁在 DOM 里靠后。
 * Teleport 到 body 的顺序是按组件挂载顺序排的，登录层在 App.vue 里先挂载，
 * 于是它永远被压在页面里的详情层下面——用户得先关掉详情才看得见登录框。
 *
 * 所以改成：谁后打开谁在上（栈深决定 z-index），并且只有栈顶那层响应
 * Esc 和点遮罩关闭，否则一次 Esc 会把两层一起关掉。
 *
 * 滚动锁用「引用计数」而不是布尔值：两层都开着时关掉一层，背景不应该恢复滚动。
 */

const stack: symbol[] = []
let savedOverflow = ''

export interface ModalHandle {
  /** 直接用在 style.zIndex 上；栈越深数值越大 */
  zIndex: number
  /** 是否是当前最上层的弹层（Esc / 点遮罩只对最上层生效） */
  isTop: () => boolean
  /** 关闭时调用，重复调用无副作用 */
  release: () => void
}

export function acquireModal(): ModalHandle {
  const id = Symbol('modal')
  stack.push(id)

  if (stack.length === 1) {
    savedOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }

  let released = false
  return {
    // 50 起步，每多一层 +10，给中间的装饰层留出插入空间
    zIndex: 40 + stack.length * 10,
    isTop: () => stack[stack.length - 1] === id,
    release() {
      if (released) return
      released = true
      const i = stack.indexOf(id)
      if (i >= 0) stack.splice(i, 1)
      if (stack.length === 0) document.body.style.overflow = savedOverflow
    },
  }
}
