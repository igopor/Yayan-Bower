import jwt from 'jsonwebtoken'
import { env } from '../env'

/**
 * 单 access token，不做 refresh token 轮换。
 *
 * 为什么够：这是一个小学生使用的学习类小站，没有支付、没有敏感数据。
 * 7 天有效期的 JWT，过期后重新收一次验证码即可。加上 refresh 轮换需要多一张表、
 * 多两个接口、多一套失效处理，收益是"长期不重新登录"，与这个小程序的形态不匹配。
 */

export interface TokenPayload {
  uid: number
}

export function signToken(uid: number): string {
  return jwt.sign({ uid } satisfies TokenPayload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  })
}

/** 校验并取 userId。无效、过期、被篡改都返回 null（调用方决定是 401 还是放行）。 */
export function readToken(token: string): number | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET)
    if (typeof payload === 'object' && payload && typeof payload.uid === 'number') {
      return payload.uid
    }
    return null
  } catch {
    return null
  }
}
