import { Router } from 'express'
import { healthRouter } from './health'
import { authRouter } from './auth'
import { pointsRouter } from './points'
import { termsRouter } from './terms'
import { elegantRouter } from './elegant'
import { favoritesRouter } from './favorites'
import { quizRouter } from './quiz'
import { checkinRouter } from './checkin'
import { mineRouter } from './mine'
import { reportRouter } from './report'
import { assessmentRouter } from './assessment'

/** 所有接口的统一挂载点 */
export const apiRouter = Router()

apiRouter.use('/', healthRouter)
apiRouter.use('/', authRouter)
apiRouter.use('/', pointsRouter)
apiRouter.use('/', termsRouter)
apiRouter.use('/', elegantRouter)
apiRouter.use('/', favoritesRouter)
apiRouter.use('/', quizRouter)
apiRouter.use('/', checkinRouter)
apiRouter.use('/', mineRouter)
apiRouter.use('/', reportRouter)
apiRouter.use('/', assessmentRouter)

// 未匹配的 /api/* 明确返回 JSON 404，而不是落到前端页面
apiRouter.use((_req, res) => {
  res.status(404).json({ code: 40400, data: null, message: '接口不存在' })
})
