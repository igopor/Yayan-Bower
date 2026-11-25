import type { AiSummaryView, ReportStats } from '../../../shared/index'
import { prisma } from '../lib/db'
import { aiReady, env } from '../env'
import { llmProvider } from './llm'
import { dateKey } from './streak'
import { getScenarioWeakness } from './stats'
import { buildAiPrompt, buildMockOutput, sanitizeAiOutput, statsSignature } from './ai-text'

/**
 * 家校反馈页的 AI 小结（调用与缓存）。
 *
 * 定位：**增强层，不是依赖层**。页面本来就有 `shared/report-text.ts` 生成的三段文案，
 * 这里生成失败（没 key / 超时 / 限流 / 模型胡说）时返回 unavailable，
 * 前端不显示卡片，页面完全正常。AI 挂了功能不会挂——这条是整套设计的地基。
 *
 * 这里只管三件事：缓存、配额、调用。文本规则全在 `ai-text.ts`（那边是纯函数，可单测）。
 *
 * 关于 API key：只从 `env` 读，只出现在 `llm.ts` 的请求头里。
 * 不落日志、不进错误信息、不下发前端。
 */

/** 缓存命中后多久之内不再重新生成（数据没变时更久，见 getAiSummary） */
const THROTTLE_MS = 10 * 60 * 1000
/** 用户点「重新生成」的最小间隔：手抖连点两下不该烧掉两次调用 */
const FORCE_MIN_INTERVAL_MS = 15 * 1000
/** 单人单日真实远程调用上限。进程内计数，重启清零——单实例部署，够用 */
const DAILY_CALL_LIMIT = 20

const callsToday = new Map<string, { day: string; n: number }>()

/** 记一次真实远程调用；超限返回 false（本次直接降级，不调用） */
function takeCallQuota(userId: number, today: string): boolean {
  const key = String(userId)
  const cur = callsToday.get(key)
  if (!cur || cur.day !== today) {
    callsToday.set(key, { day: today, n: 1 })
    return true
  }
  if (cur.n >= DAILY_CALL_LIMIT) return false
  cur.n += 1
  return true
}

const UNAVAILABLE: AiSummaryView = {
  summary: '',
  suggestions: [],
  source: 'unavailable',
  cached: false,
  generatedAt: '',
}

function parseStored(content: string): { summary: string; suggestions: string[] } | null {
  try {
    const obj = JSON.parse(content) as { summary?: unknown; suggestions?: unknown }
    if (typeof obj.summary !== 'string' || !obj.summary.trim()) return null
    return {
      summary: obj.summary,
      suggestions: Array.isArray(obj.suggestions)
        ? obj.suggestions.filter((s): s is string => typeof s === 'string')
        : [],
    }
  } catch {
    return null
  }
}

/**
 * 取 AI 小结。`force` 用于用户主动点「重新生成」。
 *
 * 缓存规则（三层，越往后越省钱）：
 * 1. 当天已有、且数据指纹一致 → 直接返回，**不调模型**；
 * 2. 当天已有、但数据变了、且距上次生成不到 10 分钟 → 先给旧的那段，
 *    避免用户每学一个词条就刷新一次、每刷新一次就调一次；
 * 3. 否则重新生成并覆盖当天记录（一天只有一行，不会无限长）。
 */
export async function getAiSummary(
  userId: number,
  stats: ReportStats,
  opts: { force?: boolean } = {},
): Promise<AiSummaryView> {
  if (!aiReady) return UNAVAILABLE

  const today = dateKey(new Date())
  const signature = statsSignature(stats)
  const cached = await prisma.aiSummary.findUnique({
    where: { userId_dateKey: { userId, dateKey: today } },
  })

  if (cached) {
    const ageMs = Date.now() - cached.updatedAt.getTime()
    // 正常访问：数据没变、或刚生成没多久 → 用缓存
    // 强制重生成：只有「15 秒内刚生成过」才拦（防连点），否则重新调
    const hit = opts.force
      ? ageMs < FORCE_MIN_INTERVAL_MS
      : cached.signature === signature || ageMs < THROTTLE_MS

    if (hit) {
      const parsed = parseStored(cached.content)
      if (parsed) {
        return {
          ...parsed,
          source: cached.model === 'mock' ? 'mock' : 'model',
          cached: true,
          generatedAt: cached.updatedAt.toISOString(),
        }
      }
    }
  }

  const isMock = llmProvider.mode === 'mock'
  if (!isMock && !takeCallQuota(userId, today)) {
    console.warn(`[ai] 用户 ${userId} 今日 AI 调用已达上限（${DAILY_CALL_LIMIT} 次），本次降级`)
    return UNAVAILABLE
  }

  try {
    const weakness = await getScenarioWeakness(userId)
    const raw = isMock
      ? buildMockOutput(stats, weakness)
      : await llmProvider.generate(buildAiPrompt(stats, weakness), { timeoutMs: env.AI_TIMEOUT_MS })

    const cleaned = sanitizeAiOutput(raw)
    if (!cleaned) throw new Error('生成内容未通过校验（为空或含不当措辞）')

    const model = isMock ? 'mock' : env.AI_MODEL
    const content = JSON.stringify(cleaned)
    const saved = await prisma.aiSummary.upsert({
      where: { userId_dateKey: { userId, dateKey: today } },
      create: { userId, dateKey: today, content, model, signature },
      update: { content, model, signature },
    })

    return {
      ...cleaned,
      source: isMock ? 'mock' : 'model',
      cached: false,
      generatedAt: saved.updatedAt.toISOString(),
    }
  } catch (e) {
    // 失败一律降级，不 throw：报告页的主体是那堆数字和三段文案，AI 只是多一块
    const msg = e instanceof Error ? e.message : String(e)
    console.warn('[ai] 生成失败，本次不显示 AI 卡片：', msg)
    return UNAVAILABLE
  }
}
