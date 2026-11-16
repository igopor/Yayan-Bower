import { env } from '../env'

/**
 * 短信通道抽象。
 *
 * 存在的理由只有一个：开发期不能没有短信，但申请真实短信签名需要备案 + 审核。
 * 业务代码只调 `smsProvider.send(phone, code)`，切换通道时改一行 env，不动业务。
 */
export interface SmsProvider {
  readonly name: string
  send(phone: string, code: string): Promise<void>
}

/**
 * Mock 通道：不发送任何东西，只把验证码打到服务端日志。
 * 登录全流程（频控、过期、错码、锁定）都能完整开发和自测。
 */
class MockSmsProvider implements SmsProvider {
  readonly name = 'mock'

  async send(phone: string, code: string): Promise<void> {
    console.log(`[sms:mock] 手机号 ${phone} 的验证码是 ${code}（未发送真实短信）`)
  }
}

/**
 * 阿里云短信通道。**当前是空壳**，只在你拿到签名与模板后才需要补实现。
 *
 * 接入时要做的三件事（按顺序）：
 * 1. 申请签名与模板，拿到 SignName / TemplateCode；
 * 2. 装 SDK：`npm i @alicloud/dysmsapi20170525 @alicloud/openapi-client`
 * 3. 补 .env：ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET / ALIYUN_SMS_SIGN_NAME / ALIYUN_SMS_TEMPLATE_CODE
 *    并在 server/src/env.ts 里加上这四项的 zod 校验
 *
 * 特别注意：个人主体申请"网站"来源的签名通常要求提供备案号。没备案时，
 * 审核可能不通过，这不是代码问题，是资质问题。
 */
class AliyunSmsProvider implements SmsProvider {
  readonly name = 'aliyun'

  async send(_phone: string, _code: string): Promise<void> {
    throw new Error(
      '阿里云短信通道尚未实现。请先完成签名/模板申请，再按 server/src/services/sms.ts 里的注释补齐实现；' +
        '开发期请把 .env 里的 SMS_PROVIDER 设为 mock。',
    )
  }
}

export const smsProvider: SmsProvider =
  env.SMS_PROVIDER === 'aliyun' ? new AliyunSmsProvider() : new MockSmsProvider()
