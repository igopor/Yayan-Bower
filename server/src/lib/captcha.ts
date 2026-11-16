import { randomInt } from 'node:crypto'
import { ApiError } from './http'
import { env } from '../env'

/**
 * 验证码存储。
 *
 * 用进程内存 Map，不入库：
 * 验证码生命周期只有 5 分钟，重启丢失后用户重新获取一次即可，已登录用户的 JWT
 * 仍然有效，不会被打断。为它单独建一张表不值得。
 *
 * 局限（明确写出来，避免以后误判）：
 * 只适用于单进程。如果将来 pm2 开 cluster 多实例，验证码会因实例不同而校验失败，
 * 那时必须换成 Redis 或数据库表。现在是单实例，不需要。
 */
interface CodeEntry {
  code: string
  expiresAt: number
  sentAt: number
  attempts: number
  /** 最近一小时内每次发送的时间戳，用于小时级频控 */
  sendTimes: number[]
}

const store = new Map<string, CodeEntry>()

const TTL_MS = 5 * 60 * 1000 // 验证码 5 分钟有效
const MAX_ATTEMPTS = 5 // 输错 5 次作废，防穷举
const MAX_SENDS_PER_HOUR = 5 // 单号每小时最多 5 条

/**
 * 重发冷却。
 * 生产（真实短信）：60 秒，防止短信费用被刷。
 * 开发（Mock 通道）：5 秒。Mock 不发真实短信，没有成本问题，但 60 秒冷却会让
 * "改完后端重启 → 重新登录"这件事每次都卡一分钟，非常影响调试节奏。
 */
const RESEND_MS = (env.SMS_PROVIDER === 'mock' ? 5 : 60) * 1000

function genCode(): string {
  // Mock 通道用固定码，方便测试与自动化；真实通道用加密随机数
  if (env.SMS_PROVIDER === 'mock') return env.SMS_MOCK_CODE
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export interface IssueResult {
  code: string
  /** 多少秒后允许再次发送 */
  cooldownSec: number
}

/** 生成并占用一个验证码。被频控拦截时抛 ApiError。 */
export function issueCode(phone: string): IssueResult {
  const now = Date.now()
  const prev = store.get(phone)

  if (prev) {
    const elapsed = now - prev.sentAt
    if (elapsed < RESEND_MS) {
      const wait = Math.ceil((RESEND_MS - elapsed) / 1000)
      throw ApiError.rateLimit(`操作太频繁，请 ${wait} 秒后再试`)
    }
  }

  const sendTimes = (prev?.sendTimes ?? []).filter((t) => now - t < 60 * 60 * 1000)
  if (sendTimes.length >= MAX_SENDS_PER_HOUR) {
    throw ApiError.rateLimit('该手机号验证码获取次数过多，请一小时后再试')
  }
  sendTimes.push(now)

  const code = genCode()
  store.set(phone, {
    code,
    expiresAt: now + TTL_MS,
    sentAt: now,
    attempts: 0,
    sendTimes,
  })

  return { code, cooldownSec: Math.round(RESEND_MS / 1000) }
}

/** 校验验证码。通过后立即作废（一次性）。失败抛 ApiError。 */
export function verifyCode(phone: string, code: string): void {
  const entry = store.get(phone)

  if (!entry) {
    throw ApiError.badRequest('验证码已失效，请重新获取')
  }
  if (Date.now() > entry.expiresAt) {
    store.delete(phone)
    throw ApiError.badRequest('验证码已过期，请重新获取')
  }
  if (entry.attempts >= MAX_ATTEMPTS) {
    store.delete(phone)
    throw ApiError.badRequest('验证码错误次数过多，请重新获取')
  }
  if (entry.code !== code) {
    entry.attempts += 1
    const left = MAX_ATTEMPTS - entry.attempts
    if (left <= 0) {
      store.delete(phone)
      throw ApiError.badRequest('验证码错误次数过多，请重新获取')
    }
    throw ApiError.badRequest(`验证码不正确，还可尝试 ${left} 次`)
  }

  store.delete(phone)
}

/** 定时清理过期条目，避免长期运行时 Map 无限增长 */
const sweeper = setInterval(() => {
  const now = Date.now()
  for (const [phone, entry] of store) {
    if (now > entry.expiresAt + 60 * 60 * 1000) store.delete(phone)
  }
}, 10 * 60 * 1000)
sweeper.unref() // 不阻止进程退出

/** 仅供测试使用 */
export function _resetCodes() {
  store.clear()
}
