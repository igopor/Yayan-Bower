import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issueCode, verifyCode, _resetCodes } from './captcha'
import { ApiError } from './http'

const PHONE = '13800138000'

/** 只伪造 Date，保留真实定时器（captcha 内部有清理定时器） */
function setNow(iso: string) {
  vi.setSystemTime(new Date(iso))
}

describe('验证码', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    setNow('2026-11-15T10:00:00+08:00')
    _resetCodes()
  })

  afterEach(() => {
    vi.useRealTimers()
    _resetCodes()
  })

  it('首次发送返回 6 位验证码', () => {
    const { code, cooldownSec } = issueCode(PHONE)
    expect(code).toMatch(/^\d{6}$/)
    expect(cooldownSec).toBeGreaterThan(0)
  })

  it('冷却期内重复发送被拒绝', () => {
    issueCode(PHONE)
    setNow('2026-11-15T10:00:02+08:00') // 冷却 5 秒内
    expect(() => issueCode(PHONE)).toThrowError(ApiError)
    try {
      issueCode(PHONE)
    } catch (e) {
      expect((e as ApiError).code).toBe(42900)
    }
  })

  it('冷却结束后可以重新发送', () => {
    issueCode(PHONE)
    setNow('2026-11-15T10:00:06+08:00')
    expect(() => issueCode(PHONE)).not.toThrow()
  })

  it('一小时内最多发送 5 次', () => {
    for (let i = 0; i < 5; i++) {
      issueCode(PHONE)
      setNow(new Date(Date.parse('2026-11-15T10:00:00+08:00') + (i + 1) * 6000).toISOString())
    }
    expect(() => issueCode(PHONE)).toThrowError(/次数过多/)
  })

  it('正确验证码校验通过，且只能用一次', () => {
    const { code } = issueCode(PHONE)
    expect(() => verifyCode(PHONE, code)).not.toThrow()
    // 一次性：再用同一个码必须失败
    expect(() => verifyCode(PHONE, code)).toThrowError(/失效/)
  })

  it('验证码 5 分钟后过期', () => {
    const { code } = issueCode(PHONE)
    setNow('2026-11-15T10:05:01+08:00')
    expect(() => verifyCode(PHONE, code)).toThrowError(/过期/)
  })

  it('连续输错 5 次后作废，错误码也不能再通过', () => {
    const { code } = issueCode(PHONE)
    for (let i = 0; i < 5; i++) {
      expect(() => verifyCode(PHONE, '000000')).toThrowError(/不正确|次数过多/)
    }
    expect(() => verifyCode(PHONE, code)).toThrowError(/次数过多|失效/)
  })

  it('未发送就校验会提示失效', () => {
    expect(() => verifyCode('13900000000', '123456')).toThrowError(/失效/)
  })
})
