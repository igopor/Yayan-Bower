import {
  QUIZ_PERFECT_RATE,
  QUIZ_SECONDS,
  QUIZ_TIMEOUT_TOLERANCE,
  type QuizPick,
  type QuizTier,
} from '../../../shared/index'

/**
 * 情景挑战里**跟数据库无关**的那部分逻辑：抽题打乱、选项映射、判分、分档。
 *
 * 为什么单独抽出来：这段是整个项目第二处必须写单测的地方（第一处是积分内核）。
 * 判分一旦写错，孩子答对了被判错，是最难被自己发现、也最伤体验的 bug。
 * 放在纯函数里，测试不用起服务、不用建库，一毫秒跑完。
 */

/** Fisher–Yates 洗牌，返回新数组，不改入参 */
export function shuffle<T>(input: readonly T[]): T[] {
  const arr = [...input]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/**
 * 屏幕位置 → 题库原始位置。
 *
 * `displaySwap` 为 true 表示这一刻左右换了，屏幕上 A 位放的其实是题库的 B。
 * 库里统一存**原始位置**，这样同一个人两次做到同一题，`chosen` 是可以直接比较的；
 * 若存屏幕位置，统计"这道题多数人掉进哪个坑"就得先把 display_swap 再套一遍。
 */
export function toOriginalPick(displayPick: QuizPick, displaySwap: boolean): QuizPick {
  if (!displaySwap) return displayPick
  return displayPick === 'A' ? 'B' : 'A'
}

/** 题库原始位置 → 屏幕位置。反馈时告诉前端该高亮左边还是右边 */
export function toDisplayPick(originalPick: QuizPick, displaySwap: boolean): QuizPick {
  return toOriginalPick(originalPick, displaySwap) // 映射是对合运算，套两次等于没换
}

/** 服务端认定的超时阈值（毫秒）。前端倒计时显示 15 秒，判定放宽 1 秒给网络 */
export const TIMEOUT_MS = (QUIZ_SECONDS + QUIZ_TIMEOUT_TOLERANCE) * 1000

export interface JudgeInput {
  /** 用户点的屏幕位置；没点（超时自动交卷）传 null */
  pick: QuizPick | null
  /** 题库里的正确答案，A 或 B */
  correctOption: string
  displaySwap: boolean
  /** 服务端算出来的用时：answeredAt - servedAt */
  elapsedMs: number
}

export interface JudgeOutput {
  /** 落到库里的原始位置；没选为 null */
  chosen: QuizPick | null
  isCorrect: boolean
  timedOut: boolean
  /** 正确答案在这块屏幕上的位置 */
  correctPick: QuizPick
}

/**
 * 判一道题。
 *
 * 三条硬规则：
 * 1. **时间由服务端算**，前端传什么时间戳都不看 —— 否则改一下电脑时钟就能无限答题。
 * 2. 超时一律判错，即使他点的正好是对的。场景挑战考的是"限时反应"，不是"慢慢想"。
 * 3. 没选（pick = null）也判错，但不算"答错"文案，前端显示"下一次再加油"。
 */
export function judge(input: JudgeInput): JudgeOutput {
  const { pick, correctOption, displaySwap, elapsedMs } = input
  const timedOut = pick === null || elapsedMs > TIMEOUT_MS
  const chosen = pick === null ? null : toOriginalPick(pick, displaySwap)
  const isCorrect = !timedOut && chosen === correctOption
  return {
    chosen,
    isCorrect,
    timedOut,
    correctPick: toDisplayPick(correctOption as QuizPick, displaySwap),
  }
}

/** 正确率百分比（0–100 整数）。四舍五入而不是向下取整：10 题对 9 题 = 90，不是 89 */
export function accuracyOf(correctCount: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((correctCount / total) * 100)
}

/**
 * 分档：≥90 优秀 / 70–89 不错 / <70 继续练。
 * 门槛写在计划书 §T6.7，别在这里偷偷改，评语文案和门槛是一套的。
 */
export function tierOf(accuracy: number): QuizTier {
  if (accuracy >= 90) return 'great'
  if (accuracy >= 70) return 'good'
  return 'keep'
}

const COMMENTS: Record<QuizTier, string> = {
  great: '眼力真好！哪些话该说、该怎么说，你已经分得很清了。',
  good: '大部分都判断对了，把答错的几题再想一遍，下一轮就是满分。',
  keep: '这一轮错的有点多，别灰心。先去热梗辨析看看这些词为什么不能乱用，再回来挑战一次。',
}

/** 每档的评语。**不含任何数字**，所以不会出现"0% 正确率很棒"这种硬伤 */
export function commentOf(tier: QuizTier): string {
  return COMMENTS[tier]
}

/** 正确率达到多少才有额外加分（0–100），供路由判断 */
export const PERFECT_ACCURACY = Math.round(QUIZ_PERFECT_RATE * 100)
