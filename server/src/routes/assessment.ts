import { Router } from 'express'
import { env } from '../env'
import { ApiError, ok, route } from '../lib/http'
import { requireAuth } from '../middleware/auth'
import { assess } from '../services/assessment'
import { validateText } from '../services/assessment-text'

export const assessmentRouter = Router()

/**
 * POST /api/assessment
 *
 * 语言测评。唯一新增接口。
 *
 * 为什么路径是 `/assessment` 而不是 `/language-assessment`：本站所有接口都是
 * 短路径（`/terms`、`/quiz/sessions`、`/report/summary`），路由文件名也是 `assessment.ts`，
 * 前后保持一致比多一个定语更好找。
 *
 * 三种结局：
 * - 参数不合格 → 40000 + 具体中文提示（前端直接显示这句）
 * - 次数用完   → 42900（前端提示"明天再来"，不重试）
 * - 其余一律 200：成功带结果，模型不可用带 `source: 'unavailable'`
 *   后者的 HTTP 状态**故意是 200**——它不是一个错误，是"这次没分析出来"，
 *   前端只要不渲染结果区就行；用 5xx 会让 axios 抛异常，前端得多写一套分支。
 */
assessmentRouter.post(
  '/assessment',
  requireAuth,
  route(async (req, res) => {
    const check = validateText(req.body?.text, { maxChars: env.ASSESS_MAX_CHARS })
    if (!check.ok) throw ApiError.badRequest(check.message)

    const outcome = await assess(req.userId!, check.text)

    if (outcome.kind === 'rate_limited') {
      throw ApiError.rateLimit('今天测评次数已用完，明天再来')
    }
    if (outcome.kind === 'unavailable') {
      return ok(res, { source: 'unavailable', result: null, points: null })
    }
    return ok(res, {
      source: outcome.source,
      result: outcome.result,
      points: outcome.points,
    })
  }),
)
