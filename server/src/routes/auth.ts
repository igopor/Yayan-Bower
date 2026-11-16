import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/db'
import { ok, ApiError, route } from '../lib/http'
import { parse } from '../lib/validate'
import { issueCode, verifyCode } from '../lib/captcha'
import { signToken } from '../lib/jwt'
import { smsProvider } from '../services/sms'
import { buildUserSummary } from '../services/user'
import { requireAuth } from '../middleware/auth'
import { env } from '../env'

export const authRouter = Router()

const phoneField = z
  .string()
  .trim()
  .regex(/^1[3-9]\d{9}$/, '请输入 11 位手机号')

const codeField = z
  .string()
  .trim()
  .regex(/^\d{6}$/, '验证码为 6 位数字')

/**
 * POST /api/auth/sms/send
 * 发送验证码。频控在 captcha 内部处理，这里只负责转调。
 */
authRouter.post(
  '/auth/sms/send',
  route(async (req, res) => {
    const { phone } = parse(z.object({ phone: phoneField }), req.body)

    const { code, cooldownSec } = issueCode(phone)
    await smsProvider.send(phone, code)

    return ok(res, {
      cooldownSec,
      /**
       * 仅 Mock 通道返回验证码，供前端在开发模式下直接显示并自动填入。
       * 真实通道下这个字段是 undefined，不会泄露任何东西。
       */
      mockCode: env.SMS_PROVIDER === 'mock' ? code : undefined,
    })
  }),
)

/**
 * POST /api/auth/sms/login
 * 校验验证码 → 首次自动建号 → 签发 JWT。
 *
 * 没有"注册"这个动作：手机号验证码登录天然就是注册即登录，
 * 单独做注册流程对小学生和家长都是多余的一步。
 *
 * **监护人同意在这里卡一道。** 新号码登录 = 建号 = 采集手机号，
 * 必须有 `agreed: true` 才放行；同时把同意时间写进 `consent_at` 留痕。
 * 前端也有勾选框，但服务端这道是"真正的门"——前端校验只能算提示。
 */
authRouter.post(
  '/auth/sms/login',
  route(async (req, res) => {
    const { phone, code, agreed } = parse(
      z.object({
        phone: phoneField,
        code: codeField,
        agreed: z.boolean().optional().default(false),
      }),
      req.body,
    )

    // 先判同意，再核销验证码：反过来会让"忘勾选"白白烧掉一条验证码，
    // 用户得等 60 秒重发才能再试一次。
    const existing = await prisma.user.findUnique({ where: { phone } })
    // 已有账号且已留痕的，回归用户不用反复同意；没留痕的（早期账号）补一次
    const needConsent = !existing || !existing.consentAt
    if (needConsent && !agreed) {
      throw ApiError.badRequest('请先阅读并同意《隐私说明》')
    }

    verifyCode(phone, code)

    const user = await prisma.user.upsert({
      where: { phone },
      create: { phone, consentAt: new Date() },
      update: needConsent ? { consentAt: new Date() } : {},
    })

    const token = signToken(user.id)
    const summary = await buildUserSummary(user)

    return ok(res, { token, user: summary })
  }),
)

/** GET /api/auth/me —— 前端启动时用它确认登录态是否还有效 */
authRouter.get(
  '/auth/me',
  requireAuth,
  route(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (!user) throw ApiError.unauthorized('账号不存在，请重新登录')

    return ok(res, await buildUserSummary(user))
  }),
)

/**
 * POST /api/auth/logout
 * 单 JWT 没有服务端会话，登出就是前端删除 token。
 * 这个接口保留是为了让前端有一个统一的"登出"调用点，
 * 将来若加入 token 黑名单，实现只改这里。
 */
authRouter.post(
  '/auth/logout',
  requireAuth,
  route(async (_req, res) => ok(res, { ok: true })),
)
