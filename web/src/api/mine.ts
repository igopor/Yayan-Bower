import type { CheckinView, MineView, ReportSummaryView } from '@shared/index'
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
