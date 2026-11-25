/**
 * 家校反馈的三段小结文案。
 *
 * 为什么放在 shared 而不是服务端：这里全是纯字符串规则，不碰数据库，
 * 单独放一个文件才能对它写单测（"任意数据组合都通顺"这条验收要求，
 * 只能靠穷举组合来保证，靠手点是点不完的）。
 *
 * 写作约束（来自设计方案，也是答辩会被问到的点）：
 * 1. 家长视角——说人话，不出现"正确率""掌握度"之外的术语堆砌；
 * 2. 不刺人——数据差时不写"太差""需要加强"，写"下一步可以做什么"；
 * 3. **不出现硬伤**——一轮没闯过时，任何一句都不许提正确率。
 *    "0% 正确率，很棒"是这类自动文案最典型的翻车方式。
 */

export interface ReportStats {
  nickname: string
  /** 看过的热梗词条数（去重） */
  termCount: number
  /** 展开过的雅词组数（去重） */
  elegantCount: number
  favoriteCount: number
  /** 完成过的闯关轮次 */
  quizRounds: number
  /** 各轮正确率平均，0–100 整数；没闯关过为 0（文案里会避开这个 0） */
  quizAvgAccuracy: number
  /** 连续打卡天数 */
  streak: number
  /** 累计有学习记录的天数 */
  activeDays: number
  badgeCount: number
  totalPoints: number
  /** 生成时间，图上要显示"截至哪天" */
  generatedAt: string
}

export interface ReportTextView {
  strengths: string[]
  improvements: string[]
  advice: string[]
}

export interface ReportSummaryView {
  stats: ReportStats
  text: ReportTextView
}

/**
 * AI 小结。
 *
 * `source` 是这三态而不是一个布尔值，因为它要同时表达三件不同的事：
 * 卡片显不显示（unavailable 不显示）、要不要标"演示"（mock 要标）、
 * 内容可信度（model 才是真模型写的）。前端只判断这一个字段。
 */
export interface AiSummaryView {
  summary: string
  suggestions: string[]
  source: 'model' | 'mock' | 'unavailable'
  /** 是否来自当天缓存（同一份数据不重复调用模型，省钱也防刷） */
  cached: boolean
  generatedAt: string
}

/** 各段最多几句。多了家长不看，图也放不下 */
const MAX_STRENGTHS = 3
const MAX_IMPROVEMENTS = 2
const MAX_ADVICE = 3

function pct(n: number): string {
  return `${Math.round(n)}%`
}

/**
 * 优势。只在数据真的撑得住时才写，
 * 宁可少一句，也不写"你已经很棒了"这种空话。
 */
function buildStrengths(s: ReportStats): string[] {
  const out: string[] = []

  if (s.quizRounds > 0) {
    if (s.quizAvgAccuracy >= 90) {
      out.push(`情景挑战平均正确率 ${pct(s.quizAvgAccuracy)}，该换说法的时候判断得很准。`)
    } else if (s.quizAvgAccuracy >= 80) {
      out.push(`情景挑战平均正确率 ${pct(s.quizAvgAccuracy)}，大部分场合已经能选对说法。`)
    } else if (s.quizAvgAccuracy >= 60) {
      out.push(`情景挑战平均正确率 ${pct(s.quizAvgAccuracy)}，看得出答题时在认真想。`)
    }
    // 低于 60 不放进优势段：这一段只讲做得好的地方
  }

  if (s.streak >= 7) {
    out.push(`连续 ${s.streak} 天来学习，这份坚持比分数更难得。`)
  } else if (s.streak >= 3) {
    out.push(`已经连续 ${s.streak} 天来学习，习惯正在形成。`)
  }

  if (s.termCount >= 20) {
    out.push(`翻过 ${s.termCount} 个热梗，见过的说法已经不少。`)
  } else if (s.termCount > 0) {
    out.push(`开始留意平时的说法了，目前翻过 ${s.termCount} 个热梗。`)
  }

  if (s.favoriteCount >= 5) {
    out.push(`收藏了 ${s.favoriteCount} 条，知道把用得上的留下来。`)
  }

  if (out.length === 0) {
    out.push(
      s.totalPoints > 0
        ? '已经开了个头，第一次打开就是最好的开始。'
        : '还没有学习记录，第一步随时可以迈出。',
    )
  }
  return out.slice(0, MAX_STRENGTHS)
}

/** 待加强。写"下一步做什么"，不写"哪里不行" */
function buildImprovements(s: ReportStats): string[] {
  const out: string[] = []

  if (s.quizRounds === 0) {
    out.push('还没做过情景挑战。光看词条知道"不能说"，闯一轮才知道自己在具体场合选不选得对。')
  } else if (s.quizAvgAccuracy < 70) {
    out.push(
      `情景挑战平均正确率 ${pct(s.quizAvgAccuracy)}，碰到拿不准的场合容易凭感觉选，先把对应词条的用法解析看一遍再挑战会好很多。`,
    )
  } else if (s.quizAvgAccuracy < 90) {
    out.push('大部分题都能选对，偶尔会在两个相近的说法之间犹豫，再练几轮会更稳。')
  }

  if (s.elegantCount === 0) {
    out.push('雅词还没展开过。"换个说法"这一步是从雅词页开始的，知道该换还不够，得先有得换。')
  } else if (s.elegantCount < 10) {
    out.push(`只展开过 ${s.elegantCount} 组雅词，可以替换的说法还可以再多攒一些。`)
  }

  if (s.streak === 0 && s.activeDays > 0) {
    out.push('最近几天没有打开，隔久了容易忘，每天几分钟就够。')
  }

  if (out.length === 0) {
    out.push('各方面都在稳步积累，下一步可以试试把收藏的说法用进日常对话。')
  }
  return out.slice(0, MAX_IMPROVEMENTS)
}

/** 给家长的具体建议。这一段是最容易写成空话的，所以每条都要能落地 */
function buildAdvice(s: ReportStats): string[] {
  const out: string[] = []

  if (s.quizRounds === 0 || s.quizAvgAccuracy < 70) {
    out.push('可以陪孩子做一轮情景挑战。选错了先别纠正，问一句"你当时怎么想的"，比直接讲答案有用。')
  } else {
    out.push('孩子的判断已经不错，可以在饭桌上问一句"今天有没有哪个词，换个说法更好听"。')
  }

  if (s.termCount < 10) {
    out.push(
      s.termCount === 0
        ? '从每天翻三五条热梗开始，一周就能积累二十多个说法。'
        : `每天翻三五条，一周就能补到二十多个；现在的 ${s.termCount} 条是个起点。`,
    )
  } else if (s.streak < 7) {
    out.push('把学习放在固定时段（比如晚饭后十分钟），比"想起来才学"更容易连成习惯。')
  } else {
    out.push('习惯已经稳了，接下来可以鼓励他把学到的雅词写进作文或日记里。')
  }

  if (s.favoriteCount === 0) {
    out.push('提醒孩子看到喜欢的说法点一下收藏，收藏夹会慢慢变成他自己的小词库。')
  }

  return out.slice(0, MAX_ADVICE)
}

export function buildReportText(stats: ReportStats): ReportTextView {
  return {
    strengths: buildStrengths(stats),
    improvements: buildImprovements(stats),
    advice: buildAdvice(stats),
  }
}
