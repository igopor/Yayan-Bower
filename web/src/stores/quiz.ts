import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { QuizAnswerView, QuizPick, QuizResultView, QuizSessionView } from '@shared/index'
import { finishQuiz, startQuestion, startQuiz, submitAnswer } from '@/api/quiz'

/**
 * 一轮挑战的全部状态。
 *
 * 为什么放 store 而不是页面局部 ref：答题页和结果页是两个路由，
 * 结果页要拿"这一轮答对几题"，用路由参数传一串题面太重，
 * 用 sessionStorage 又要自己管过期。pinia 里放着，跳页不丢。
 *
 * 代价：**刷新页面 = 这一轮丢了**（断线恢复本期不做），
 * 所以答题页检测到 store 空就回 /quiz 重新开始。这是计划书里明确接受的行为。
 */
export const useQuizStore = defineStore('quiz', () => {
  const session = ref<QuizSessionView | null>(null)
  /** 当前第几题（0 起） */
  const index = ref(0)
  /**
   * 本题的起点，换算成本地时钟的毫秒时间戳。
   * 用 `Date.now() - 服务端 elapsedMs` 而不是直接用 ISO 字符串：
   * 用户电脑时间可能和服务器差几分钟，直接比会有整分钟的误差。
   */
  const questionStartedAt = ref(0)
  const feedback = ref<QuizAnswerView | null>(null)
  const result = ref<QuizResultView | null>(null)
  const starting = ref(false)
  const submitting = ref(false)

  const current = computed(() => session.value?.questions[index.value] ?? null)
  const total = computed(() => session.value?.total ?? 0)
  const seconds = computed(() => session.value?.seconds ?? 0)
  const seq = computed(() => index.value + 1)
  const isLast = computed(() => session.value !== null && seq.value >= total.value)

  function reset() {
    session.value = null
    index.value = 0
    questionStartedAt.value = 0
    feedback.value = null
    result.value = null
  }

  /** 进入第 n 题：服务端打起点，本地据此启动倒计时 */
  async function begin(n: number) {
    if (!session.value) return
    const r = await startQuestion(session.value.sessionId, n)
    index.value = n - 1
    questionStartedAt.value = Date.now() - r.elapsedMs
  }

  /** 开新一轮。会先把上一轮界面状态清干净，避免"再来一次"看到上轮残留 */
  async function start() {
    starting.value = true
    try {
      reset()
      session.value = await startQuiz()
      await begin(1)
    } finally {
      starting.value = false
    }
  }

  /**
   * 交当前题。`pick` 为 null 表示超时没选上。
   * 返回值交给页面做反馈弹窗；同一题重复调用由服务端幂等处理。
   */
  async function submit(pick: QuizPick | null): Promise<QuizAnswerView | null> {
    if (!session.value || submitting.value || feedback.value) return null
    submitting.value = true
    try {
      const r = await submitAnswer(session.value.sessionId, seq.value, pick)
      feedback.value = r
      return r
    } finally {
      submitting.value = false
    }
  }

  /** 关掉反馈、进入下一题。最后一题之后调用处应改走结算 */
  async function next() {
    const f = feedback.value
    if (!f || f.nextSeq === null) return
    feedback.value = null
    await begin(f.nextSeq)
  }

  /** 结算。幂等，结果页刷新可以安全地再调一次 */
  async function finish() {
    if (!session.value) return null
    result.value = await finishQuiz(session.value.sessionId)
    return result.value
  }

  /** 结果页兜底：手上没有结果时按 sessionId 重新取一次 */
  async function loadResult(sessionId: number) {
    result.value = await finishQuiz(sessionId)
    return result.value
  }

  return {
    session,
    index,
    questionStartedAt,
    feedback,
    result,
    starting,
    submitting,
    current,
    total,
    seconds,
    seq,
    isLast,
    reset,
    start,
    submit,
    next,
    finish,
    loadResult,
  }
})
