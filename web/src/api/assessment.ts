import type { AssessResponse } from '@shared/index'
import { apiPost } from './http'

/**
 * 语言测评：提交一段文字，拿回四维结果。
 *
 * 原文只在本站服务端 → 模型厂商之间走一次，**本站不保存**；
 * 前端把结果存在 localStorage，所以刷新页面还能看到上次的，但那是用户自己浏览器里的。
 */
export function assessText(text: string) {
  return apiPost<AssessResponse>('/assessment', { text })
}
