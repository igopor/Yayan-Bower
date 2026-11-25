import type { AiSummaryView, CheckinView, MineView, ReportSummaryView } from '@shared/index'
import { apiGet, apiPost } from './http'

/** 「我的」页要的全部数据，一次请求画完 */
export function fetchMine() {
  return apiGet<MineView>('/mine')
}

/**
 * 自动打卡。幂等，可以在启动、登录、进「我的」页时放心多调几次。
 * 返回值里 `reason === 'no_activity'` 表示"今天还没学习"，前端不要弹任何提示。
 */
export function checkIn() {
  return apiPost<CheckinView>('/checkin')
}

/** 家校反馈：数字 + 三段小结文案（文案在服务端生成） */
export function fetchReportSummary() {
  return apiGet<ReportSummaryView>('/report/summary')
}

/**
 * AI 小结。**故意和上面分开请求**：数字立刻就能画，模型要等几秒。
 * 合在一起会让整页干等，拆开则页面先出来、卡片后到。
 *
 * 返回 `source: 'unavailable'` 表示 AI 未开启或调用失败（不是错误），调用方直接不显示卡片。
 */
export function fetchAiSummary(force = false) {
  return apiPost<AiSummaryView>('/report/ai-summary', { force })
}
