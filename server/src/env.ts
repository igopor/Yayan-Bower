import 'dotenv/config'
import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().default(3000),
  JWT_SECRET: z.string().min(8),
  JWT_EXPIRES_IN: z.string().default('7d'),
  SMS_PROVIDER: z.enum(['mock', 'aliyun']).default('mock'),
  SMS_MOCK_CODE: z.string().default('123456'),

  /**
   * ── AI 小结（可选功能）──────────────────────────────
   *
   * off   ：关闭。报告页不出现 AI 卡片，现有三段文案照常。
   * mock  ：演示通道。不联网、不花钱，用本地规则模拟一段小结。
   * openai：调用 OpenAI 兼容接口（DeepSeek / 通义 / 智谱 / Kimi / 本地 Ollama 都是这套协议）。
   *
   * 默认 mock 而不是 openai：没配 key 时项目仍然**能跑、能演示**，
   * 不会因为一个新功能把原有启动流程弄挂。
   */
  AI_PROVIDER: z.enum(['off', 'mock', 'openai']).default('mock'),
  AI_API_KEY: z.string().default(''),
  AI_BASE_URL: z.string().default('https://api.deepseek.com/v1'),
  AI_MODEL: z.string().default('deepseek-chat'),
  /** 单次调用超时。超过就降级，绝不让报告页卡在一个转圈上 */
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(8000),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  console.error('\n[env] 环境变量配置有误，请检查根目录 .env：')
  for (const issue of parsed.error.issues) {
    console.error('  -', issue.path.join('.'), issue.message)
  }
  process.exit(1)
}

export const env = parsed.data

/**
 * AI 是否真的可用。
 *
 * 注意这里**只判断、不报错**：AI 是增强项，不是启动依赖。
 * `AI_PROVIDER=openai` 但忘了填 key 时，降级成关闭并打一条警告，
 * 而不是让整个服务起不来 —— 一个新功能不该有能力把老功能拖下水。
 */
export const aiReady = env.AI_PROVIDER !== 'off' && (env.AI_PROVIDER === 'mock' || !!env.AI_API_KEY)

if (!aiReady && env.AI_PROVIDER === 'openai') {
  console.warn('[ai] AI_PROVIDER=openai 但没有填 AI_API_KEY，AI 小结已自动关闭')
}
