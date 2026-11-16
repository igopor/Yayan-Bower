import type { NextFunction, Request, Response } from 'express'
import { readToken } from '../lib/jwt'
import { ApiError } from '../lib/http'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** 由 identify / requireAuth 填充。未登录时为 undefined。 */
      userId?: number
    }
  }
}

function extract(req: Request): number | undefined {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return undefined
  return readToken(header.slice(7)) ?? undefined
}

/**
 * 必须登录。放在写作类接口上（收藏、答题、生成小结）。
 * 抛出的 401 会被前端拦截器捕获，弹出登录层，登录后回到原操作。
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const uid = extract(req)
  if (uid === undefined) return next(ApiError.unauthorized())
  req.userId = uid
  next()
}

/**
 * 可选登录。放在读接口上（列表、详情）。
 *
 * 作用：未登录也能正常浏览全部内容，这是设计方案的明确要求
 * （"先看到价值，再要求注册"）。但登录后同一个接口要能返回"我有没有收藏过"，
 * 所以要读 token 而不强制。
 */
export function identify(req: Request, _res: Response, next: NextFunction) {
  const uid = extract(req)
  if (uid !== undefined) req.userId = uid
  next()
}
