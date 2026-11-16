import type { z } from 'zod'
import { ApiError } from './http'

/**
 * 把 zod 校验失败转成业务错误。
 * 只取第一条错误展示给用户——表单一次只改一处，列一堆问题反而看不懂。
 */
export function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input)
  if (!result.success) {
    const first = result.error.issues[0]
    throw ApiError.badRequest(first?.message ?? '参数不正确')
  }
  return result.data
}
