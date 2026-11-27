import { env } from '../env'

/**
 * 大模型通道抽象。
 *
 * 与 `sms.ts` 同一个思路：业务层只认 `llmProvider.generate(prompt)`，
 * 换厂商只改 .env，不动业务代码。三个实现：
 *
 * - off   ：关闭。上层看到 mode 就不会调用。
 * - mock  ：不联网、不花钱，供演示与自测。**内容由 ai-summary 用本地规则现编**，
 *           所以这里的方法不该被调用到。
 * - remote：OpenAI 兼容协议（DeepSeek / 通义 / 智谱 / Kimi / 本地 Ollama 都是这套）。
 *
 * 关于 API key 的安全边界，这个文件是唯一接触它的地方：
 * 1. 只从 `env` 读，值来自服务端 .env（已在 .gitignore 里），不写进代码；
 * 2. 只出现在请求头里，**不进日志、不进错误信息、不返回给浏览器**；
 * 3. 浏览器永远拿不到它——前端调的是本站 `/api/report/ai-summary`，由这里代为请求。
 */
/**
 * 一次调用的可调项。
 *
 * `system` 与 `maxTokens` 是后加的：原来只服务"AI 小结"这一种输出（两段话，500 token 够）。
 * 语言测评要输出四维结构化 JSON，一条就 700–1000 token，还用 500 会**必然被截断**，
 * 截断后 JSON 解析失败、结果永远 unavailable。因此把两者做成可选参数，
 * 不传时保持原来的默认值 —— 阶段 9 的行为一个字节都不变。
 */
export interface LlmCallOptions {
  timeoutMs: number
  /** 覆盖默认的 system 提示词 */
  system?: string
  /** 覆盖默认的 500。四维 JSON 这类长输出要自己给够 */
  maxTokens?: number
}

export interface LlmProvider {
  readonly mode: 'off' | 'mock' | 'remote'
  /** 给人看的通道名，只用于日志 */
  readonly label: string
  generate(prompt: string, opts: LlmCallOptions): Promise<string>
}

/** 默认 system：阶段 9 的 AI 小结在用，改成常量只是为了能被覆盖 */
const DEFAULT_SYSTEM = '你是一位耐心、务实的小学语文老师。只输出 JSON，不要任何解释。'
/** 默认输出上限：一段总评 + 2–3 条建议，500 足够 */
const DEFAULT_MAX_TOKENS = 500

class OffProvider implements LlmProvider {
  readonly mode = 'off' as const
  readonly label = 'off'

  async generate(): Promise<string> {
    throw new Error('AI 通道已关闭')
  }
}

class MockProvider implements LlmProvider {
  readonly mode = 'mock' as const
  readonly label = 'mock'

  async generate(): Promise<string> {
    // 演示通道不产生远程调用，内容由 ai-summary 的本地规则生成
    throw new Error('mock 通道不发起远程调用')
  }
}

class RemoteProvider implements LlmProvider {
  readonly mode = 'remote' as const
  readonly label: string

  constructor() {
    this.label = `${env.AI_MODEL} @ ${new URL(env.AI_BASE_URL).host}`
  }

  async generate(prompt: string, opts: LlmCallOptions): Promise<string> {
    const url = `${env.AI_BASE_URL.replace(/\/+$/, '')}/chat/completions`

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.AI_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.AI_MODEL,
        messages: [
          { role: 'system', content: opts.system ?? DEFAULT_SYSTEM },
          { role: 'user', content: prompt },
        ],
        // 低温度：小结要稳，不要每次都换个说法，也不要在数字上发挥
        temperature: 0.4,
        max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      }),
      // 超时即中断，避免报告页挂在一个不返回的请求上
      signal: AbortSignal.timeout(opts.timeoutMs),
    })

    if (!res.ok) {
      // 只截取前 200 字：厂商的错误体偶尔会回显请求头，长错误一律不落日志
      const body = await res.text().catch(() => '')
      throw new Error(`模型接口返回 ${res.status}：${body.slice(0, 200)}`)
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>
    }
    const content = json.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('模型返回内容为空')
    }
    return content
  }
}

function pick(): LlmProvider {
  if (env.AI_PROVIDER === 'off') return new OffProvider()
  if (env.AI_PROVIDER === 'mock') return new MockProvider()
  // 选了 remote 却没给 key：一律降级为关闭，绝不带着空 key 去请求
  if (!env.AI_API_KEY) {
    console.warn('[ai] 缺少 AI_API_KEY，AI 小结已关闭')
    return new OffProvider()
  }
  return new RemoteProvider()
}

export const llmProvider: LlmProvider = pick()

if (llmProvider.mode === 'remote') {
  // 只打通道名与模型名，**不打 key**（连前后几位都不打）
  console.log(`[ai] 已启用远程通道：${llmProvider.label}`)
} else if (llmProvider.mode === 'mock') {
  console.log('[ai] 使用演示通道（不联网，内容由本地规则模拟）')
}
