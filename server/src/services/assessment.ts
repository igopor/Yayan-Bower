import { env, aiReady } from '../env'
import type { GrantResult } from '../../../shared/index'
import type { AssessResult } from '../../../shared/assessment'
import { llmProvider } from './llm'
import { grant } from './points'
import { dateKey } from './streak'
import {
  ASSESS_SYSTEM_PROMPT,
  buildAssessPrompt,
  mockAssessment,
  sanitizeResult,
} from './assessment-text'

/**
 * 语言测评的调用编排：限次 → 调模型 → 清洗 → 发分。
 *
 * 文本规则全在 `assessment-text.ts`（纯函数、可单测）；这里只管有副作用的事。
 *
 * 定位和 AI 小结一致：**增强层**。没开 AI、超时、报错、输出不合格，
 * 一律返回 unavailable，绝不 throw 到 500 —— 页面只是不显示结果，输入内容还在。
 *
 * 与 AI 小结的两个不同：
 * 1. 不落库。原文和结果都不进数据库，只有 localStorage 留在用户自己浏览器里；
 * 2. 不缓存。同一段文字每次都真实分析，换来的是"改一版再看一版"的体验，
 *    代价由每日次数上限兜住。
 */

/** 真实通道的默认每日上限（env 可改） */
const REAL_LIMIT_FALLBACK = env.ASSESS_DAILY_LIMIT
/**
 * mock 通道的额度下限。
 *
 * 演示通道一分钱不花，却被 10 次卡住会很难受——答辩现场试几次就"明天再来"。
 * 所以 mock 至少放 50 次；真实的远程调用仍然按 env 的 10 次算，因为那是花钱的。
 */
const MOCK_LIMIT_MIN = 50

/**
 * 四维 JSON 的输出上限。
 *
 * 阶段 9 的 500 是给"一段总评 + 两三条建议"的；这里的结构光汉字就 600 多，
 * 加上 JSON 键名约 900–1000 token。给 1200 留一点余量，少了必然被截断，
 * 截断的 JSON 解析不出来，功能表现为"永远 unavailable"。
 */
const ASSESS_MAX_TOKENS = 1200

const daily = new Map<number, { day: string; n: number }>()

/** 当前生效的每日额度。mock 放宽，真实调用按配置 */
export function assessDailyLimit(): number {
  return llmProvider.mode === 'mock'
    ? Math.max(REAL_LIMIT_FALLBACK, MOCK_LIMIT_MIN)
    : REAL_LIMIT_FALLBACK
}

/** 记一次调用。超限返回 false（本次不调用、直接告知用户） */
function takeQuota(userId: number, today: string): boolean {
  const limit = assessDailyLimit()
  const cur = daily.get(userId)
  if (!cur || cur.day !== today) {
    daily.set(userId, { day: today, n: 1 })
    return true
  }
  if (cur.n >= limit) return false
  cur.n += 1
  return true
}

export type AssessOutcome =
  | { kind: 'ok'; source: 'mock' | 'model'; result: AssessResult; points: GrantResult }
  | { kind: 'unavailable' }
  | { kind: 'rate_limited' }

/**
 * 跑一次测评。
 *
 * 返回的是"结果状态"而不是抛异常：超限要变成业务码 42900（让前端提示"明天再来"），
 * 所以超限单独一个 kind；其余失败一律 unavailable，路由层转成 200 + 空结果。
 */
export async function assess(userId: number, text: string): Promise<AssessOutcome> {
  if (!aiReady) return { kind: 'unavailable' }

  const today = dateKey(new Date())
  // 只在"校验通过、真的要调模型"时计数；校验失败在路由层就返回了，不消耗次数
  if (!takeQuota(userId, today)) return { kind: 'rate_limited' }

  const started = Date.now()
  const source: 'mock' | 'model' = llmProvider.mode === 'mock' ? 'mock' : 'model'

  try {
    // 演示通道也走同一条清洗链：这样单测验过的"mock 输出能过 sanitizeResult"，
    // 就是真实运行路径，而不是另写一套只在测试里成立的东西
    const raw =
      llmProvider.mode === 'mock'
        ? JSON.stringify(mockAssessment(text))
        : await llmProvider.generate(buildAssessPrompt(text), {
            timeoutMs: env.AI_TIMEOUT_MS,
            system: ASSESS_SYSTEM_PROMPT,
            maxTokens: ASSESS_MAX_TOKENS,
          })

    const result = sanitizeResult(raw, text)
    if (!result) {
      console.warn(`[assess] 输出未通过校验，本次降级 source=${source} ${Date.now() - started}ms`)
      return { kind: 'unavailable' }
    }

    // 同一天只加一次：bizId 用日期键，第二次 grant 返回 duplicate，前端据此不飘字
    const points = await grant(userId, 'ASSESSMENT', today)

    // 只打来源与耗时：不打原文、不打 key、不打模型输出
    console.log(`[assess] source=${source} ${Date.now() - started}ms`)
    return { kind: 'ok', source, result, points }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn(`[assess] 调用失败 source=${source} ${Date.now() - started}ms：${msg}`)
    return { kind: 'unavailable' }
  }
}
