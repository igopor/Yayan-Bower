import { createApp } from './app'
import { env } from './env'
import { prisma } from './lib/db'

const app = createApp()

const server = app.listen(env.PORT, () => {
  console.log(`\n  雅言小筑 接口已启动`)
  console.log(`  http://localhost:${env.PORT}/api/health`)
  console.log(`  短信通道: ${env.SMS_PROVIDER}${env.SMS_PROVIDER === 'mock' ? `（验证码固定 ${env.SMS_MOCK_CODE}）` : ''}\n`)
})

async function shutdown(signal: string) {
  console.log(`\n[app] 收到 ${signal}，正在关闭…`)
  server.close()
  await prisma.$disconnect()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
