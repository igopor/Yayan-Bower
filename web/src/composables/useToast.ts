import { ref } from 'vue'

export interface ToastItem {
  id: number
  text: string
  type: 'info' | 'ok' | 'bad' | 'point' | 'badge'
}

const items = ref<ToastItem[]>([])
let seq = 0

function push(text: string, type: ToastItem['type'] = 'info', ms = 2000) {
  const id = ++seq
  items.value.push({ id, text, type })
  setTimeout(() => {
    items.value = items.value.filter((t) => t.id !== id)
  }, ms)
}

/** 全站提示。积分变动用 point('+2 分') 会显示成橙色飘字 */
export const toast = {
  info: (t: string) => push(t, 'info'),
  ok: (t: string) => push(t, 'ok'),
  bad: (t: string) => push(t, 'bad'),
  point: (t: string) => push(t, 'point', 1400),
  /** 徽章解锁，停留久一点：这是孩子最想看清的一句话 */
  badge: (t: string) => push(t, 'badge', 3200),
}

export function useToastState() {
  return { items }
}
