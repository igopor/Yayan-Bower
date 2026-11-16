import type {
  QuizAnswerView,
  QuizPick,
  QuizResultView,
  QuizSessionView,
  QuizStartView,
} from '@shared/index'
import { apiPost } from './http'

/**
 * 情景挑战接口。和别的模块一样，页面只调这里的函数。
 *
 * 注意这里**没有**"取正确答案"之类的接口 —— 答案不下发是这模块的设计前提，
 * 判分全在服务端，前端拿到的只有"对不对"和"该高亮哪个"。
 */

/** 开一轮：抽题 + 决定每题左右顺序。返回体不含答案 */
export function startQuiz() {
  return apiPost<QuizSessionView>('/quiz/sessions')
}

/** 进入某题，服务端打计时起点。重复调用返回同一时刻，不会重置倒计时 */
export function startQuestion(sessionId: number, seq: number) {
  return apiPost<QuizStartView>(`/quiz/sessions/${sessionId}/start`, { seq })
}

/**
 * 交一题。`pick` 是**屏幕位置**（用户点的左边还是右边），超时自动交卷传 null。
 * 返回里带 isCorrect / timedOut / correctPick / explanation，反馈弹窗只用这些。
 */
export function submitAnswer(sessionId: number, seq: number, pick: QuizPick | null) {
  return apiPost<QuizAnswerView>(`/quiz/sessions/${sessionId}/answers`, { seq, pick })
}

/** 结算。幂等：结果页刷新时会再调一次，积分不会重复发 */
export function finishQuiz(sessionId: number) {
  return apiPost<QuizResultView>(`/quiz/sessions/${sessionId}/finish`)
}
