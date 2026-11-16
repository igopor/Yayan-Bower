import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/db'
import { ok, ApiError, route } from '../lib/http'
import { parse } from '../lib/validate'
import { identify } from '../middleware/auth'
import { grant } from '../services/points'
import { evaluateBadges } from '../services/badges'
import type { BadgeDef, GrantResult } from '../../../shared/index'

export const elegantRouter = Router()

const PAGE_SIZE = 20

/**
 * 雅词积累的三个接口。
 *
 * 与辨析页的区别：这里**列表不返回对照词**，只返回热梗名和"有几条替换"，
 * 真正的两条雅词在展开时才请求 `/elegant/:termId`。
 *
 * 为什么这样切：
 * 1. 49 组各两条释义，一次全塞进列表是 20×4 段长文本，手机首屏会等到卡；
 * 2. 更重要的是——**展开那一刻才是"我真的读了这两条"**，浏览积分挂在这里
 *    才有意义。挂列表接口的话，翻页就能刷分，孩子不会真看。
 */
elegantRouter.get(
  '/elegant',
  identify,
  route(async (req, res) => {
    const { keyword, page } = parse(
      z.object({
        keyword: z.string().trim().max(50).optional().default(''),
        page: z.coerce.number().int().min(1).default(1),
      }),
      req.query,
    )

    /**
     * 搜索范围包含**替换词本身**。
     * 孩子记得"无与伦比"却忘了它对应哪个热梗，从这里搜能搜到——
     * 这是雅词页比辨析页更需要的能力：雅词是"我想换一种说法"，入口往往是那个雅词。
     */
    const where = {
      hasElegant: true,
      status: 1,
      ...(keyword
        ? {
            OR: [
              { name: { contains: keyword } },
              {
                elegant: {
                  is: {
                    OR: [
                      { word1: { contains: keyword } },
                      { word2: { contains: keyword } },
                      { def1: { contains: keyword } },
                      { def2: { contains: keyword } },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    }

    const [rows, total] = await Promise.all([
      prisma.term.findMany({
        where,
        orderBy: { sort: 'asc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          name: true,
          plainMeaning: true,
          showInTerms: true,
          elegant: { select: { word1: true, word2: true } },
        },
      }),
      prisma.term.count({ where }),
    ])

    // 收藏态一次查完，不在循环里逐条查（49 条就是 49 次往返）
    const favSet = req.userId
      ? new Set(
          (
            await prisma.favorite.findMany({
              where: { userId: req.userId, termId: { in: rows.map((r) => r.id) } },
              select: { termId: true },
            })
          ).map((r) => r.termId),
        )
      : new Set<number>()

    return ok(res, {
      items: rows.map((r) => ({
        termId: r.id,
        name: r.name,
        plainMeaning: r.plainMeaning,
        // 有用法解析才给"去辨析页看"的入口；没有的话点过去是一张空卡片
        hasHeuristic: r.showInTerms && !!r.plainMeaning,
        favorited: favSet.has(r.id),
      })),
      total,
      page,
      pageSize: PAGE_SIZE,
      hasMore: page * PAGE_SIZE < total,
    })
  }),
)

/**
 * GET /api/elegant/daily-sentence
 * 每日一句。同一天永远返回同一条，跨天自动换。
 *
 * 不用"随机"：随机的话用户刷新两次看到两句，会觉得这一句不重要。
 * 用 `天数 % 总数` 取序号，是确定的、可预期的，也不需要存"今天推过哪句"。
 *
 * 必须注册在 `/elegant/:termId` 之前，否则会被当成 termId 解析。
 */
elegantRouter.get(
  '/elegant/daily-sentence',
  route(async (_req, res) => {
    const total = await prisma.dailySentence.count({ where: { status: 1 } })
    if (total === 0) throw ApiError.notFound('暂无每日一句')

    /**
     * 按**服务器本地日期**算第几天，而不是 `Date.now()/86400000`（那是 UTC 天）。
     * UTC 天在中国时区意味着"早上 8 点才换句"——孩子 7 点打开看到的还是昨天那句。
     * 减掉时区偏移即可得到本地天序号。部署到 UTC 机器时要设 `TZ=Asia/Shanghai`。
     */
    const now = new Date()
    const localDayIndex = Math.floor((now.getTime() - now.getTimezoneOffset() * 60_000) / 86_400_000)
    const offset = localDayIndex % total

    const row = await prisma.dailySentence.findFirst({
      where: { status: 1 },
      orderBy: { seq: 'asc' },
      skip: offset,
      select: { seq: true, content: true, source: true, meaning: true, themes: true },
    })
    if (!row) throw ApiError.notFound('暂无每日一句')

    return ok(res, row)
  }),
)

/**
 * GET /api/elegant/:termId
 * 一组对照 + 收藏态 + 本次展开的加分结果。
 *
 * **浏览积分（ELEGANT_VIEW）在这里发**，理由和辨析页详情一致：
 * 展开即阅读，副作用幂等（同一组一天只给一次），少一次往返。
 * 与 TERM_VIEW 共用同一个每日 20 分上限，所以两页轮着看不会翻倍。
 */
elegantRouter.get(
  '/elegant/:termId',
  identify,
  route(async (req, res) => {
    const termId = Number(req.params.termId)
    if (!Number.isInteger(termId) || termId <= 0) throw ApiError.notFound('雅词不存在')

    const term = await prisma.term.findUnique({
      where: { id: termId },
      select: {
        id: true,
        name: true,
        plainMeaning: true,
        heuristicAnalysis: true,
        showInTerms: true,
        elegant: true,
      },
    })
    if (!term?.elegant) throw ApiError.notFound('雅词不存在')

    const favorited = req.userId
      ? !!(await prisma.favorite.findUnique({
          where: { userId_termId: { userId: req.userId, termId } },
          select: { id: true },
        }))
      : false

    let points: GrantResult | null = null
    let newBadges: BadgeDef[] = []
    if (req.userId) {
      try {
        points = await grant(req.userId, 'ELEGANT_VIEW', termId)
        // 只在雅词页学习的孩子也要能拿到「初次查梗」
        newBadges = await evaluateBadges(req.userId)
      } catch (e) {
        // 积分是附赠，绝不能因为它把内容打挂
        console.error('[elegant] 浏览积分/徽章判定失败', {
          userId: req.userId,
          termId,
          err: e,
        })
      }
    }

    return ok(res, {
      termId: term.id,
      name: term.name,
      plainMeaning: term.plainMeaning,
      // 只有辨析页收录的词才有解析，可以给"看它怎么用"的入口（T5.3 双向联动）
      hasHeuristic: term.showInTerms && !!term.heuristicAnalysis,
      words: [
        { word: term.elegant.word1, definition: term.elegant.def1 },
        { word: term.elegant.word2, definition: term.elegant.def2 },
      ],
      favorited,
      points,
      newBadges,
    })
  }),
)
