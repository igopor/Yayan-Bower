/**
 * 前后端共用的类型与常量。
 * 这里只放"两边都要用"的东西，业务逻辑不写在这。
 */

import type { BadgeDef } from './badges'

// ── 内容 ──────────────────────────────────────────
export interface Term {
  id: number
  name: string
  plainMeaning: string
  heuristicAnalysis: string
  isFeatured: boolean
  sort: number
  showInTerms: boolean
  hasElegant: boolean
}

export interface ElegantPair {
  word1: string
  def1: string
  word2: string
  def2: string
}

export interface TermDetail extends Term {
  elegant: ElegantPair | null
}

/** 列表里的词条：比完整词条少了长文本解析，多了"我收藏了没" */
export interface TermListItem {
  id: number
  name: string
  plainMeaning: string
  isFeatured: boolean
  hasElegant: boolean
  favorited: boolean
}

/** 详情页返回：内容 + 收藏态 + 这次浏览的加分结果（未登录为 null） */
export interface TermDetailView extends Term {
  elegant: ElegantPair | null
  favorited: boolean
  points: GrantResult | null
  /** 这次动作顺带解锁的徽章。绝大多数时候是空数组，前端只在非空时提示 */
  newBadges: BadgeDef[]
}

/** 分页返回的通用外壳 */
export interface Paged<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

/** 辨析页的列表返回：零结果时多带一个"这个词在雅词库里有"的提示 */
export interface TermListPage extends Paged<TermListItem> {
  /** 命中雅词库的词名；没有则为 null */
  elegantHint: string | null
}

/** 收藏 / 取消收藏的结果。取消时 points 恒为 null（不扣分） */
export interface FavoriteResult {
  favorited: boolean
  points: GrantResult | null
  /** 收藏第 20 条的那一刻会解锁「收藏家」，前端据此提示 */
  newBadges: BadgeDef[]
}

export interface FavoriteListItem {
  termId: number
  name: string
  plainMeaning: string
  hasElegant: boolean
  favoritedAt: string
}

export interface DailySentence {
  seq: number
  content: string
  source: string
  meaning: string
  themes: string
}

/**
 * 雅词列表项。
 * 注意这里**没有对照词**——两条替换词要展开时才取。
 * 49 组一次全塞进列表是 20×4 段长文本，手机首屏会等到卡；
 * 更要紧的是"展开 = 真的读了"，浏览积分挂在那一下才有意义。
 */
export interface ElegantListItem {
  termId: number
  name: string
  plainMeaning: string
  /** 辨析页是否收录了它的用法解析（决定要不要给"看它怎么用"的入口） */
  hasHeuristic: boolean
  favorited: boolean
}

export interface ElegantWord {
  word: string
  definition: string
}

/** 展开一组对照时返回：两条雅词 + 收藏态 + 本次展开的加分结果 */
export interface ElegantDetailView {
  termId: number
  name: string
  plainMeaning: string
  hasHeuristic: boolean
  words: ElegantWord[]
  favorited: boolean
  points: GrantResult | null
  /** 只在雅词页学习的孩子也能拿到「初次查梗」，所以这里同样要判 */
  newBadges: BadgeDef[]
}

/** 屏幕上两个位置：A = 左边那个，B = 右边那个。注意与题库里的 A/B 不是一回事（有交换） */
export type QuizPick = 'A' | 'B'

export interface QuizQuestionView {
  seq: number
  stem: string
  /** 按展示顺序排好的两个选项：options[0] 就是 A 位 */
  options: [string, string]
  displaySwap: boolean
}

/** 开一轮的返回。**不含任何答案字段**——判分只在服务端 */
export interface QuizSessionView {
  sessionId: number
  total: number
  /** 每题限时（秒），前端倒计时用它，不写死 */
  seconds: number
  questions: QuizQuestionView[]
}

/** 进入某一题时服务端打的时间戳。重复调用返回同一个时刻，不能用来重置计时 */
export interface QuizStartView {
  seq: number
  startedAt: string
  seconds: number
  /** 这道题已经开始了多久（毫秒），刷新/切后台回来据此校正倒计时 */
  elapsedMs: number
}

export interface QuizAnswerView {
  seq: number
  isCorrect: boolean
  /** 超时（含"没来得及选"） */
  timedOut: boolean
  /** 正确答案在这次展示里的位置，前端用来标出该高亮哪一个 */
  correctPick: QuizPick
  correctText: string
  explanation: string
  /** true = 重复提交的回放，不是这次新判的分 */
  replayed: boolean
  /** 下一题序号，最后一题为 null */
  nextSeq: number | null
}

/** 结算分档：优秀 / 不错 / 继续练。文案在服务端定，前端只渲染 */
export type QuizTier = 'great' | 'good' | 'keep'

export interface QuizResultView {
  sessionId: number
  total: number
  /** 实际作答数。中途退出的轮次会小于 total，未答的算错 */
  answeredCount: number
  correctCount: number
  /** 0–100 整数 */
  accuracy: number
  tier: QuizTier
  comment: string
  /** 完成一轮的基础分（重复结算时为 duplicate，delta 为 0） */
  finishPoints: GrantResult
  /** 正确率达标才有，未达标为 null */
  perfectPoints: GrantResult | null
  /** 本轮实际到手的积分总和。从流水求和，不靠上面两个结果相加 —— 重复结算时它们都是 0 */
  totalEarned: number
  /** 本轮顺带解锁的徽章（首次闯关 / 满分达人 / 积跬步） */
  newBadges: BadgeDef[]
}

// ── 账号与积分 ────────────────────────────────────
export interface UserSummary {
  id: number
  nickname: string
  phone: string
  totalPoints: number
  todayEarned: number
  badgeCount: number
}

export type PointBizType =
  | 'TERM_VIEW'
  | 'ELEGANT_VIEW'
  | 'FAVORITE'
  | 'QUIZ_FINISH'
  | 'QUIZ_PERFECT'
  | 'DAILY_CHECKIN'
  | 'STREAK_BONUS'

/** 没加成分的原因，前端据此给不同提示 */
export type GrantReason = 'ok' | 'duplicate' | 'daily_cap'

/** 积分发放结果。后端 grant() 的返回值，前端拿它同步顶栏数字并飘提示。 */
export interface GrantResult {
  granted: boolean
  delta: number
  balance: number
  reason: GrantReason
}

/** 积分概览 */
export interface PointsSummary {
  total: number
  today: number
  /** 今天在浏览类（词条/雅词）上已经拿到的分 */
  todayView: number
  /** 浏览类日上限，前端用它显示"18/20"这类进度 */
  viewCap: number
}

// ── 打卡 / 徽章 / 我的 ─────────────────────────────

/**
 * 打卡不是"点一下签到"，而是**今天确实学了**（查词条、展开雅词、完成一轮闯关）。
 * 这样"连续 7 天"才是"连续 7 天来学习"，而不是"连续 7 天来点一下按钮"。
 */
export type CheckinReason = 'ok' | 'already' | 'no_activity'

export interface CheckinView {
  /** 今天是否已打卡 */
  checkedIn: boolean
  reason: CheckinReason
  /** 当前连续天数：今天学了算到含今天，今天还没学则算到昨天（不算断） */
  streak: number
  /** 本次打卡发的分；已打过、或今天还没学，为 null */
  points: GrantResult | null
  /** 连续天数撞上 7 的倍数时的额外奖励 */
  streakPoints: GrantResult | null
  /** 这次解锁的徽章 */
  newBadges: BadgeDef[]
}

/** 徽章墙的一项：定义 + 我解锁了没有 */
export interface BadgeView extends BadgeDef {
  unlocked: boolean
  /** 未解锁为 null */
  unlockedAt: string | null
}

/** GET /api/mine 一次返回「我的」页要的全部数据，不做多次往返 */
export interface MineView {
  user: UserSummary
  points: PointsSummary
  streak: number
  /** 今天打过卡没有（= 今天有学习记录）。false 时页面提示"今天还没开始" */
  checkedInToday: boolean
  badges: BadgeView[]
  favorites: FavoriteListItem[]
  /** 查过多少个词条（辨析 + 雅词去重） */
  termCount: number
  /** 完成过几轮闯关 */
  quizRounds: number
}

// ── 家校反馈 ──────────────────────────────────────
// ReportStats / ReportTextView / buildReportText 都在 ./report-text，这里只做再导出：
// 三段小结的判断规则是纯函数，需要能单独写单测，所以不混进这个类型文件。

// ── 统一响应 ──────────────────────────────────────
export interface ApiOk<T> {
  code: 0
  data: T
  message: 'ok'
}

export interface ApiErr {
  code: number
  data: null
  message: string
}

export const ERR = {
  UNAUTHORIZED: 40100,
  FORBIDDEN: 40300,
  NOT_FOUND: 40400,
  RATE_LIMIT: 42900,
  BAD_REQUEST: 40000,
} as const

// 把类型从各个常量文件里再导出一次，调用方只 import '@shared'
export * from './point-rules'
export * from './badges'
export * from './report-text'
