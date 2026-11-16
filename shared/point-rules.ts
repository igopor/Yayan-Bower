import type { PointBizType } from './index'

/** 分值表：改数值只改这里，业务代码不动 */
export const POINT_RULES: Record<PointBizType, number> = {
  TERM_VIEW: 2,
  ELEGANT_VIEW: 2,
  FAVORITE: 1,
  QUIZ_FINISH: 10,
  QUIZ_PERFECT: 5,
  DAILY_CHECKIN: 3,
  STREAK_BONUS: 20,
}

/** 浏览类（词条/雅词）每日合计上限 */
export const DAILY_VIEW_CAP = 20

/** 计入"浏览类"的业务类型 */
export const VIEW_BIZ_TYPES: PointBizType[] = ['TERM_VIEW', 'ELEGANT_VIEW']

/** 连续打卡满多少天给额外奖励 */
export const STREAK_TARGET = 7

/**
 * 一轮闯关的题数。
 *
 * 定 10 而不是 20：题库只有 23 题，抽 20 只剩 3 题余量，第二次玩几乎全是重题；
 * 抽 10 每次组合都不一样，一轮约 2–3 分钟，也更适合课间玩一次。
 */
export const QUIZ_SIZE = 10

/** 单题限时（秒） */
export const QUIZ_SECONDS = 15

/**
 * 超时判定的宽限秒数（服务端计算时用）。
 *
 * 为什么留 1 秒而不是 0：网络往返 + 服务端处理要几十到几百毫秒。
 * 学生卡着最后一秒点，请求到达时已经 15.2 秒，判错就是冤案。
 * 宽限只放宽服务端判定，前端倒计时仍显示 15 秒 —— 显示和判定分开是刻意的，
 * 否则"倒计时 15 但实际能答 16 秒"会被眼尖的孩子发现。
 */
export const QUIZ_TIMEOUT_TOLERANCE = 1

/** 正确率达到多少额外加分 */
export const QUIZ_PERFECT_RATE = 0.8
