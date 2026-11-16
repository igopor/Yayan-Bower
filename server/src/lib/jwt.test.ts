import { describe, expect, it } from 'vitest'
import jwt from 'jsonwebtoken'
import { readToken, signToken } from './jwt'
import { env } from '../env'

describe('JWT', () => {
  it('签发的 token 能读回同一个 userId', () => {
    const token = signToken(42)
    expect(readToken(token)).toBe(42)
  })

  it('签名被篡改时返回 null', () => {
    const token = signToken(1)
    const tampered = `${token.slice(0, -3)}xyz`
    expect(readToken(tampered)).toBeNull()
  })

  it('用别的密钥签发的 token 返回 null', () => {
    const forged = jwt.sign({ uid: 1 }, 'another-secret-key')
    expect(readToken(forged)).toBeNull()
  })

  it('已过期的 token 返回 null', () => {
    const expired = jwt.sign({ uid: 1 }, env.JWT_SECRET, { expiresIn: -10 })
    expect(readToken(expired)).toBeNull()
  })

  it('payload 里没有 uid 的 token 返回 null', () => {
    const noUid = jwt.sign({ foo: 'bar' }, env.JWT_SECRET)
    expect(readToken(noUid)).toBeNull()
  })

  it('垃圾字符串不会抛异常，只返回 null', () => {
    expect(readToken('not-a-token')).toBeNull()
    expect(readToken('')).toBeNull()
  })
})
