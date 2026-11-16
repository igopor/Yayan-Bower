import 'dotenv/config'
import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().default(3000),
  JWT_SECRET: z.string().min(8),
  JWT_EXPIRES_IN: z.string().default('7d'),
  SMS_PROVIDER: z.enum(['mock', 'aliyun']).default('mock'),
  SMS_MOCK_CODE: z.string().default('123456'),
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
