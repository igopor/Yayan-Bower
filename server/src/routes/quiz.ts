import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/db'
import { ok, ApiError, route } from '../lib/http'
import { parse } from '../lib/validate'
import { requireAuth } from '../middleware/auth'
import { grant } from '../services/points'
import { evaluateBadges } from '../services/badges'
import {
  QUIZ_SECONDS,
  QUIZ_SIZE,
  type QuizAnswerView,
  type QuizPick,
  type QuizQuestionView,
  type QuizResultView,
  type QuizSessionView,
  type QuizStartView,
} from '../../../shared/index'
import {
  PERFECT_ACCURACY,
  TIMEOUT_MS,
  accuracyOf,
  commentOf,
  judge,
  shuffle,
  tierOf,
  toDisplayPick,
} from '../services/quiz'

export const quizRouter = Router()

/**
 * 情景挑战。三个接口对应一轮的三个阶段：
 *   1. `POST /quiz/sessions`      开一轮：抽题、决定每题的左右顺序，返回题面（不含答案）
 *   2. `POST /quiz/sessions/:id/start`   进入某题：打服务端计时起点
 *   3. `POST /quiz/sessions/:id/answers` 交一题：服务端判分、判超时
 *   4. `POST /quiz/sessions/:id/finish`  结算：算正确率、发积分（幂等）
 *
 * 贯穿全模块的一条原则：**凡是能决定得分的东西，都在服务端算**。
 * 题目答案不下发、用时由服务端时间戳算、积分由积分内核发。
 * 前端只负责"画"和"点"，它算出来的任何数字都不参与判分。
 */

/** 三个接口共用的取会话逻辑：顺带做完鉴权与参数校验 */
async function loadSession(userId: number, rawId: string) {
  const id = Number(rawId)
  if (!Number.isInteger(id) || id <= 0) throw ApiError.badRequest('参数不正确')

  const session = await prisma.quizSession.findFirst({
    where: { id, userId }, // 带上 userId：拿到别人的会话 id 也打不开
    include: { items: { orderBy: { seq: 'asc' } } },
  })
  if (!session) throw ApiError.notFound('这一轮挑战不存在')
  return session
}

type LoadedSession = Awaited<ReturnType<typeof loadSession>>

/** 当前该做第几题 = 最小的未答序号。用它挡"跳题""倒回去改答案" */
function expectedSeq(session: LoadedSession): number | null {
  const item = session.items.find((i) => !i.answeredAt)
  return item ? item.seq : null
}

function optionText(correctOption: string, a: string, b: string): string {
  return correctOption === 'A' ? a : b
}

/**
 * POST /api/quiz/sessions
 *
 * 抽题：从启用的题库里洗牌后取前 QUIZ_SIZE 道，不重复；
 * 每道题独立随机决定这次是否左右互换。返回体里**没有 correctOption**。
 */
quizRouter.post(
  '/quiz/sessions',
  requireAuth,
  route(async (req, res) => {
    const userId = req.userId!

    const pool = await prisma.quizQuestion.findMany({
      where: { status: 1 },
      select: { id: true },
    })
    if (!pool.length) throw ApiError.notFound('题库还没准备好，请稍后再试')

    // 题库比一轮题数少时按实际数量开，不硬凑重复题
    const picked = shuffle(pool).slice(0, Math.min(QUIZ_SIZE, pool.length))
    const swapFlags = picked.map(() => Math.random() < 0.5)

    // 断线恢复本期不做（刷新即重新开始），所以把该用户还挂着的旧会话直接作废。
    // 不作废的后果是 status 永远停在 playing，将来统计"闯关轮次"要额外过滤。
    const [, session] = await prisma.$transaction([
      prisma.quizSession.updateMany({
        where: { userId, status: 'playing' },
        data: { status: 'abandoned' },
      }),
      prisma.quizSession.create({
        data: {
          userId,
          total: picked.length,
          items: {
            create: picked.map((q, i) => ({
              seq: i + 1,
              questionId: q.id,
              displaySwap: swapFlags[i],
            })),
          },
        },
      }),
    ])

    const rows = await prisma.quizQuestion.findMany({
      where: { id: { in: picked.map((q) => q.id) } },
    })
    const byId = new Map(rows.map((r) => [r.id, r]))

    const questions: QuizQuestionView[] = picked.map((q, i) => {
      const row = byId.get(q.id)!
      const swap = swapFlags[i]
      return {
        seq: i + 1,
        stem: row.stem,
        // 交换只影响展示顺序，不动数据。前端按 options[0] = A 位渲染
        options: (swap ? [row.optionB, row.optionA] : [row.optionA, row.optionB]) as [
          string,
          string,
        ],
        displaySwap: swap,
      }
    })

    const data: QuizSessionView = {
      sessionId: session.id,
      total: picked.length,
      seconds: QUIZ_SECONDS,
      questions,
    }
    return ok(res, data)
  }),
)

/**
 * POST /api/quiz/sessions/:id/start  { seq }
 *
 * 打计时起点。**只打一次**：重复调用返回最早的那个时刻，不能用来重置倒计时。
 * 为什么需要这个接口：服务端无法知道用户什么时候点了「下一题」。
 * 如果在开轮时给 10 道题统一写 servedAt，第 10 题会被算成用了 3 分钟，直接判超时。
 */
quizRouter.post(
  '/quiz/sessions/:id/start',
  requireAuth,
  route(async (req, res) => {
    const { seq } = parse(z.object({ seq: z.coerce.number().int().positive() }), req.body)
    const session = await loadSession(req.userId!, req.params.id)

    if (session.status === 'finished') throw ApiError.badRequest('这一轮已经结束了')
    if (session.status === 'abandoned') throw ApiError.badRequest('这一轮已作废，请重新开始')

    const item = session.items.find((i) => i.seq === seq)
    if (!item) throw ApiError.badRequest('这道题不存在')
    if (item.answeredAt) throw ApiError.badRequest('这道题已经答过了')
    if (expectedSeq(session) !== seq) throw ApiError.badRequest('请从当前这道题继续作答')

    const startedAt = item.servedAt ?? new Date()
    if (!item.servedAt) {
      await prisma.quizSessionItem.update({
        where: { sessionId_seq: { sessionId: session.id, seq } },
        data: { servedAt: startedAt },
      })
    }

    const data: QuizStartView = {
      seq,
      startedAt: startedAt.toISOString(),
      seconds: QUIZ_SECONDS,
      elapsedMs: Date.now() - startedAt.getTime(),
    }
    return ok(res, data)
  }),
)

/**
 * POST /api/quiz/sessions/:id/answers  { seq, pick }
 *
 * `pick` 是**屏幕位置**（用户点的左边还是右边），不是题库里的正确答案位置。
 * 服务端用这题的 displaySwap 换算回原始位置再比，所以前端永远不需要知道答案。
 *
 * 幂等：同一 seq 重复提交原样返回第一次的结果，不重新判分 ——
 * 孩子手抖连点两下、或网络重发，都不该变成"后一次覆盖前一次"。
 */
quizRouter.post(
  '/quiz/sessions/:id/answers',
  requireAuth,
  route(async (req, res) => {
    const { seq, pick } = parse(
      z.object({
        seq: z.coerce.number().int().positive(),
        // 超时自动交卷时传 null；用 nullish 容忍字段缺失
        pick: z.enum(['A', 'B']).nullish(),
      }),
      req.body,
    )

    const session = await loadSession(req.userId!, req.params.id)
    if (session.status === 'finished') throw ApiError.badRequest('这一轮已经结束了')
    if (session.status === 'abandoned') throw ApiError.badRequest('这一轮已作废，请重新开始')

    const item = session.items.find((i) => i.seq === seq)
    if (!item) throw ApiError.badRequest('这道题不存在')

    const q = await prisma.quizQuestion.findUnique({ where: { id: item.questionId } })
    if (!q) throw ApiError.notFound('这道题已从题库移除')

    const correctPick = toDisplayPick(q.correctOption as QuizPick, item.displaySwap)
    const correctText = optionText(q.correctOption, q.optionA, q.optionB)
    const nextSeq = seq < session.total ? seq + 1 : null

    // ── 重复提交：回放第一次的判定结果 ──
    if (item.answeredAt) {
      const elapsed = item.servedAt ? item.answeredAt.getTime() - item.servedAt.getTime() : 0
      const data: QuizAnswerView = {
        seq,
        isCorrect: item.isCorrect === true,
        timedOut: item.chosen === null || elapsed > TIMEOUT_MS,
        correctPick,
        correctText,
        explanation: q.explanation,
        replayed: true,
        nextSeq,
      }
      return ok(res, data)
    }

    if (!item.servedAt) throw ApiError.badRequest('这道题还没开始，请先进入该题')
    if (expectedSeq(session) !== seq) throw ApiError.badRequest('请按顺序作答，不能跳题')

    const now = new Date()
    const verdict = judge({
      pick: (pick ?? null) as QuizPick | null,
      correctOption: q.correctOption,
      displaySwap: item.displaySwap,
      elapsedMs: now.getTime() - item.servedAt.getTime(),
    })

    await prisma.quizSessionItem.update({
      where: { sessionId_seq: { sessionId: session.id, seq } },
      data: {
        chosen: verdict.chosen,
        isCorrect: verdict.isCorrect,
        answeredAt: now,
      },
    })

    const data: QuizAnswerView = {
      seq,
      isCorrect: verdict.isCorrect,
      timedOut: verdict.timedOut,
      correctPick: verdict.correctPick,
      correctText,
      explanation: q.explanation,
      replayed: false,
      nextSeq,
    }
    return ok(res, data)
  }),
)

/**
 * POST /api/quiz/sessions/:id/finish
 *
 * 结算。可以重复调用（结果页刷新会再调一次），积分靠积分内核的幂等键保证只发一次。
 * `totalEarned` 从流水求和而不是把两次 grant 的 delta 相加：
 * 第二次调用时两次 grant 都是 duplicate（delta = 0），相加会显示"本轮 +0 分"。
 */
quizRouter.post(
  '/quiz/sessions/:id/finish',
  requireAuth,
  route(async (req, res) => {
    const userId = req.userId!
    const session = await loadSession(userId, req.params.id)

    if (session.status === 'abandoned') throw ApiError.badRequest('这一轮已作废，请重新开始')

    const answeredCount = session.items.filter((i) => i.answeredAt).length
    if (answeredCount === 0) throw ApiError.badRequest('还没有答题，无法结算')

    // 已结算过就沿用当时记录的对题数，不用当前 items 重算 ——
    // 万一以后有"改答案"功能，历史结果也不该跟着变。
    const correctCount =
      session.status === 'finished'
        ? session.correctCount
        : session.items.filter((i) => i.isCorrect === true).length

    if (session.status !== 'finished') {
      await prisma.quizSession.updateMany({
        where: { id: session.id, userId, status: 'playing' },
        data: { status: 'finished', finishedAt: new Date(), correctCount },
      })
    }

    const accuracy = accuracyOf(correctCount, session.total)
    const tier = tierOf(accuracy)

    const finishPoints = await grant(userId, 'QUIZ_FINISH', session.id)
    const perfectPoints =
      accuracy >= PERFECT_ACCURACY ? await grant(userId, 'QUIZ_PERFECT', session.id) : null

    // 「首次闯关」「满分达人」「积跬步」都在这里判：结算是一轮挑战唯一的确权时刻。
    // 重复结算时会多跑几次判定，但全部已解锁后只剩一次查询，可以忽略。
    const newBadges = await evaluateBadges(userId)

    const earned = await prisma.pointRecord.aggregate({
      where: {
        userId,
        bizId: String(session.id),
        bizType: { in: ['QUIZ_FINISH', 'QUIZ_PERFECT'] },
      },
      _sum: { delta: true },
    })

    const data: QuizResultView = {
      sessionId: session.id,
      total: session.total,
      answeredCount,
      correctCount,
      accuracy,
      tier,
      comment: commentOf(tier),
      finishPoints,
      perfectPoints,
      totalEarned: earned._sum.delta ?? 0,
      newBadges,
    }
    return ok(res, data)
  }),
)
