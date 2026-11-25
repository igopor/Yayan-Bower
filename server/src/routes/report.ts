import { Router } from 'express'
import { prisma } from '../lib/db'
import { ok, ApiError, route } from '../lib/http'
import { requireAuth } from '../middleware/auth'
import { buildReportText, type ReportSummaryView } from '../../../shared/index'
import { getReportStats } from '../services/stats'
import { getAiSummary } from '../services/ai-summary'

export const reportRouter = Router()

/**
 * GET /api/report/summary
 *
 * 报告页要的两块：一套数字 + 三段小结。
 *
 * 文案在服务端生成（规则来自 `shared/report-text.ts` 的纯函数），不交给前端：
 * 1. 前端不需要那一堆阈值判断，页面只管画；
 * 2. 将来出"分享给家长"的纯文本版（比如微信文案），用的还是同一份规则；
 * 3. 三段文案能被单测覆盖——"任意数据组合都通顺"这条验收要求，
 *    只有纯函数才验得了。
 *
 * 新用户（一条记录都没有）也正常返回零值，不 500、不空页面：
 * 报告页要能显示"还没有学习记录，去首页看看"的引导，而不是报错。
 */
reportRouter.get(
  '/report/summary',
  requireAuth,
  route(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { nickname: true },
    })
    if (!user) throw ApiError.notFound('账号不存在')

    const stats = await getReportStats(req.userId!, user.nickname)
    const data: ReportSummaryView = { stats, text: buildReportText(stats) }
    return ok(res, data)
  }),
)

/**
 * POST /api/report/ai-summary
 *
 * **为什么不塞进 `/report/summary` 一起返回**：模型最慢要几秒，甚至超时。
 * 塞在一起，家长就得盯着一整页空白转圈——那堆数字明明是立刻就有的。
 * 拆成两步：页面先用数字和三段文案画出来，AI 卡片后到，谁也别拖累谁。
 *
 * `force: true` 表示用户点了"重新生成"；不传则走当天缓存（见 services/ai-summary.ts）。
 * 未登录、AI 关闭、调用失败都**不报错**，统一返回 `source: 'unavailable'`，
 * 前端据此决定不显示这张卡片。
 */
reportRouter.post(
  '/report/ai-summary',
  requireAuth,
  route(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { nickname: true },
    })
    if (!user) throw ApiError.notFound('账号不存在')

    const stats = await getReportStats(req.userId!, user.nickname)
    const force = req.body?.force === true
    const data = await getAiSummary(req.userId!, stats, { force })
    return ok(res, data)
  }),
)
