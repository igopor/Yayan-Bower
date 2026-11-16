import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { ERR } from '../../../shared/index'

/** 业务异常：throw 出来由全局错误中间件统一转成响应 */
export class ApiError extends Error {
  constructor(
    public code: number,
    message: string,
    public httpStatus = 200,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  static unauthorized(msg = '请先登录') {
    return new ApiError(ERR.UNAUTHORIZED, msg)
  }
  static forbidden(msg = '没有权限') {
    return new ApiError(ERR.FORBIDDEN, msg)
  }
  static notFound(msg = '内容不存在') {
    return new ApiError(ERR.NOT_FOUND, msg)
  }
  static badRequest(msg = '参数不正确') {
    return new ApiError(ERR.BAD_REQUEST, msg)
  }
  static rateLimit(msg = '操作太频繁，请稍后再试') {
    return new ApiError(ERR.RATE_LIMIT, msg)
  }
}

/** 成功响应：{ code: 0, data, message: 'ok' } */
export function ok<T>(res: Response, data: T) {
  return res.json({ code: 0, data, message: 'ok' })
}

/** 失败响应 */
export function fail(res: Response, code: number, message: string) {
  return res.json({ code, data: null, message })
}

/**
 * 异步路由包装器。
 *
 * Express 4 不会自动捕获 async handler 的 rejection —— 直接写 async 路由并在里面
 * throw，请求会一直挂着不返回，控制台只有一条 UnhandledPromiseRejection。
 * 这个包装把 rejection 转成 next(err)，交给 app.ts 的全局错误中间件。
 *
 * 规矩：**所有 async 路由都必须用 route() 包起来**，同步路由不需要。
 */
export function route(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next)
  }
}
