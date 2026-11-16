import { Router } from 'express'
import { prisma } from '../lib/db'
import { ok, ApiError, route } from '../lib/http'
import { requireAuth } from '../middleware/auth'
import { buildReportText, type ReportSummaryView } from '../../../shared/index'
import { getReportStats } from '../services/stats'

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
