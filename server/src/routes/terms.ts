import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/db'
import { ok, ApiError, route } from '../lib/http'
import { parse } from '../lib/validate'
import { identify } from '../middleware/auth'
import { grant } from '../services/points'
import { evaluateBadges } from '../services/badges'
import type { BadgeDef, GrantResult, PointBizType } from '../../../shared/index'

export const termsRouter = Router()

/** 列表每页条数。全库 41 条辨析词条，两页到底 */
const PAGE_SIZE = 20
/** 精选区最多展示条数 */
const FEATURED_LIMIT = 10

/**
 * 一次查出"这批词条里我收藏了哪些"。
 *
 * 为什么不在循环里逐条查：41 条词条就是 41 次查询，手机上要等一秒以上。
 * 收成一次 `IN (...)` 查询，返回 Set 供 O(1) 判断。
 */
async function favoritedIdSet(
  userId: number | undefined,
  ids: number[],
): Promise<Set<number>> {
  if (!userId || ids.length === 0) return new Set()
  const rows = await prisma.favorite.findMany({
    where: { userId, termId: { in: ids } },
    select: { termId: true },
  })
  return new Set(rows.map((r) => r.termId))
}

function toItem(
  t: { id: number; name: string; plainMeaning: string; isFeatured: boolean; hasElegant: boolean },
  fav: Set<number>,
) {
  return {
    id: t.id,
    name: t.name,
    plainMeaning: t.plainMeaning,
    isFeatured: t.isFeatured,
    hasElegant: t.hasElegant,
    favorited: fav.has(t.id),
  }
}

/**
 * GET /api/terms/featured
 * 精选固定展示 10 条。按 `sort` 升序 —— **不随机**，这是设计方案的要求：
 * 精选区是"我先看到什么"，同一批内容每次进来位置一致，孩子才好找。
 *
 * 必须注册在 `/terms/:id` 之前，否则 featured 会被当成 id 吃掉。
 */
termsRouter.get(
  '/terms/featured',
  identify,
  route(async (req, res) => {
    const rows = await prisma.term.findMany({
      where: { isFeatured: true, showInTerms: true, status: 1 },
      orderBy: { sort: 'asc' },
      take: FEATURED_LIMIT,
    })
    const fav = await favoritedIdSet(req.userId, rows.map((r) => r.id))
    return ok(res, rows.map((r) => toItem(r, fav)))
  }),
)

/**
 * GET /api/terms?keyword=&page=
 * 词条列表 + 模糊搜索。空关键词返回全部。
 *
 * 匹配范围是「名称 + 通俗释义」：孩子搜"绝绝子"按名称命中，
 * 搜"完蛋"按释义命中"芭比Q了"。解析正文不参与匹配——它太长，
 * 命中率低反而会让真正的结果被淹没。
 */
termsRouter.get(
  '/terms',
  identify,
  route(async (req, res) => {
    const { keyword, page } = parse(
      z.object({
        keyword: z.string().trim().max(50).optional().default(''),
        page: z.coerce.number().int().min(1).default(1),
      }),
      req.query,
    )

    const where = {
      showInTerms: true,
      status: 1,
      ...(keyword
        ? {
            OR: [
              { name: { contains: keyword } },
              { plainMeaning: { contains: keyword } },
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
      }),
      prisma.term.count({ where }),
    ])

    /**
     * 辨析页搜不到时，看一眼雅词库里有没有。
     *
     * 真实场景：孩子搜「绝绝子」，辨析页 41 条里没有它，但这个网站其实收录了
     * ——它只在雅词页出现（`showInTerms=false`，没有"什么时候不能说的"解析）。
     * 不提示的话，用户会认为"整个网站没有这个词"，直接走掉。
     *
     * 只在**零结果**时多查一次，正常搜索路径上没有任何额外开销。
     */
    let elegantHint: string | null = null
    if (total === 0 && keyword) {
      const hit = await prisma.term.findFirst({
        where: { hasElegant: true, status: 1, name: { contains: keyword } },
        select: { name: true },
      })
      elegantHint = hit?.name ?? null
    }

    const fav = await favoritedIdSet(req.userId, rows.map((r) => r.id))
    return ok(res, {
      items: rows.map((r) => toItem(r, fav)),
      total,
      page,
      pageSize: PAGE_SIZE,
      hasMore: page * PAGE_SIZE < total,
      elegantHint,
    })
  }),
)

/**
 * GET /api/terms/:id?source=terms|elegant
 * 词条详情。三块内容：通俗释义、启发式解析、更文雅的说法（有才显示）。
 *
 * **浏览积分在这里发**（T4.2），不在前端单独调一个加分接口：
 * 少一次往返，也不会出现"看到内容了但分没加上"的缝隙。
 * 重复打开同一个词条不会重复给分，靠 (user, biz_type, biz_id) 唯一键。
 *
 * `source` 决定记哪种浏览分：辨析页来的是 TERM_VIEW，雅词页反查进来的是
 * ELEGANT_VIEW。两者都计入同一个每日 20 分上限，所以不会因为分两个类型而多给。
 */
termsRouter.get(
  '/terms/:id',
  identify,
  route(async (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) throw ApiError.notFound('词条不存在')

    const term = await prisma.term.findUnique({
      where: { id },
      include: { elegant: true },
    })
    if (!term) throw ApiError.notFound('词条不存在')

    const favorited = req.userId
      ? !!(await prisma.favorite.findUnique({
          where: { userId_termId: { userId: req.userId, termId: id } },
          select: { id: true },
        }))
      : false

    const bizType: PointBizType = req.query.source === 'elegant' ? 'ELEGANT_VIEW' : 'TERM_VIEW'
    let points: GrantResult | null = null
    let newBadges: BadgeDef[] = []
    if (req.userId) {
      try {
        points = await grant(req.userId, bizType, id)
        // 第一次打开词条会解锁「初次查梗」。判完立刻返回，前端才能当场飘提示，
        // 而不是等到下次打开「我的」才发现多了个徽章。
        newBadges = await evaluateBadges(req.userId)
      } catch (e) {
        // 积分和徽章都是附赠功能，绝不能因为它们失败而让内容打不开。
        // 记日志后继续返回内容，用户最多少两分，不会看到一个白屏。
        console.error('[terms] 浏览积分/徽章判定失败', { userId: req.userId, termId: id, err: e })
      }
    }

    return ok(res, {
      id: term.id,
      name: term.name,
      plainMeaning: term.plainMeaning,
      heuristicAnalysis: term.heuristicAnalysis,
      isFeatured: term.isFeatured,
      sort: term.sort,
      showInTerms: term.showInTerms,
      hasElegant: term.hasElegant,
      elegant: term.elegant
        ? {
            word1: term.elegant.word1,
            def1: term.elegant.def1,
            word2: term.elegant.word2,
            def2: term.elegant.def2,
          }
        : null,
      favorited,
      points,
      newBadges,
    })
  }),
)
