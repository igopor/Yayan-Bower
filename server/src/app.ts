import express, { type NextFunction, type Request, type Response } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { apiRouter } from './routes/index'
import { ApiError } from './lib/http'
import { ERR } from '../../shared/index'

export function createApp() {
  const app = express()

  app.use(express.json({ limit: '256kb' }))

  // 轻量请求日志：单人开发时这一行就够定位问题
  app.use((req, res, next) => {
    const t0 = Date.now()
    res.on('finish', () => {
      const ms = Date.now() - t0
      if (req.path.startsWith('/api')) {
        console.log(`${req.method} ${req.path} ${res.statusCode} ${ms}ms`)
      }
    })
    next()
  })

  app.use('/api', apiRouter)

  // 生产模式：若已构建前端产物，则同端口提供静态页 + history 回退
  const distDir = path.resolve(process.cwd(), 'web/dist')
  if (fs.existsSync(path.join(distDir, 'index.html'))) {
    // 带 hash 的静态资源可以长缓存；index.html 不能，否则改了代码用户还看旧的
    app.use(express.static(distDir, { maxAge: '7d', index: false }))
    app.get(/^\/(?!api|assets).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-store')
      res.sendFile(path.join(distDir, 'index.html'))
    })
    console.log('[app] 已启用静态托管:', distDir)
  } else {
    console.log('[app] 未找到 web/dist，仅提供接口（开发模式由 Vite 提供页面）')
  }

  // 全局错误处理：ApiError 走业务码，其余按 500 兜底
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      return res.status(err.httpStatus).json({
        code: err.code,
        data: null,
        message: err.message,
      })
    }
    console.error('[app] 未捕获异常:', err)
    return res.status(500).json({
      code: 50000,
      data: null,
      message: '服务器开小差了，请稍后再试',
    })
  })

  return app
}

export { ERR }
