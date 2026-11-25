import type { ReportStats } from '../../../shared/index'
import type { ScenarioWeakness } from './stats'

/**
 * AI 小结的**文本规则**：拼 prompt、清洗输出、演示通道的假文案。
 *
 * 单独一个文件的原因和 `shared/report-text.ts` 一样：这些全是纯字符串处理，
 * 不碰网络、不碰数据库，才能穷举组合做单测。`ai-summary.ts` 只负责调用与缓存。
 *
 * 两条硬约束（面向未成年人，出问题就是事故）：
 * 1. 不许出现"太差""落后""笨"这类对孩子下判断的话；
 * 2. 没闯过关时，任何一句都不许提正确率——"0% 正确率"是这类自动文案最典型的翻车。
 */

export const MAX_SUMMARY = 180
export const MAX_SUGGESTION = 55
export const MAX_SUGGESTIONS = 3
const MIN_SUGGESTION = 4

/**
 * 命中即整段作废的词。
 * 清单刻意短：只收"对孩子下负面判断"的说法，不收"差"这种单字
 * （"差别""时差"都会误伤，宁可少拦也不要误杀正常表达）。
 */
export const RISKY_WORDS = [
  '太差',
  '很差',
  '落后',
  '不如别人',
  '笨',
  '懒',
  '糟糕',
  '没救',
  '无可救药',
  '倒数',
] as const

/** 数据的指纹。数字没变就不重新生成 */
export function statsSignature(s: ReportStats): string {
  return [
    s.termCount,
    s.elegantCount,
    s.favoriteCount,
    s.quizRounds,
    s.quizAvgAccuracy,
    s.streak,
    s.activeDays,
    s.badgeCount,
    s.totalPoints,
  ].join('|')
}

function tidy(input: string): string {
  return input
    .replace(/[*_`#>]/g, '')
    .replace(/^\s*[-·•]\s*/gm, '')
    .replace(/\s+/g, ' ')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim()
}

/** 截断到最后一个句读，避免"……78"这种半句 */
function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const at = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('；'), cut.lastIndexOf('，'))
  return (at > max * 0.5 ? cut.slice(0, at) : cut) + '…'
}

function hasRisky(text: string): boolean {
  return RISKY_WORDS.some((w) => text.includes(w))
}

/**
 * 清洗模型输出。
 *
 * 优先按 JSON 解析（prompt 里要求了），解析失败就把整段当总评——
 * 模型不守格式是这个方案里最常见的失败方式，不能因此让卡片消失。
 * 返回 null 表示这段内容不可用（空、或含不当措辞），由调用方降级。
 */
export function sanitizeAiOutput(raw: string): { summary: string; suggestions: string[] } | null {
  let parsed: unknown = null
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      parsed = JSON.parse(raw.slice(start, end + 1))
    } catch {
      parsed = null
    }
  }

  let summary = ''
  let rawSuggestions: unknown = []
  const parsedOk = !!parsed && typeof parsed === 'object'

  if (parsedOk) {
    const obj = parsed as Record<string, unknown>
    if (typeof obj.summary === 'string') summary = obj.summary
    rawSuggestions = obj.suggestions
  }
  if (!summary.trim()) {
    // 格式合法但总评为空 → 这张卡片没有意义，降级。
    // 注意**不能**退回"整段当总评"：那段是 JSON 原文，
    // 会把 {"summary":"","suggestions":[]} 原样贴到家长眼前。
    if (parsedOk) return null
    // 完全没解析出 JSON，说明模型没守格式，这时整段话就是它想说的内容
    summary = raw
    rawSuggestions = []
  }

  const cleanSummary = tidy(summary)
  if (!cleanSummary || hasRisky(cleanSummary)) return null

  const list = Array.isArray(rawSuggestions) ? rawSuggestions : []
  const suggestions: string[] = []
  for (const item of list) {
    if (typeof item !== 'string') continue
    const text = tidy(item)
    if (text.length < MIN_SUGGESTION) continue
    if (hasRisky(text)) continue
    const clipped = clip(text, MAX_SUGGESTION)
    if (suggestions.includes(clipped)) continue
    suggestions.push(clipped)
    if (suggestions.length >= MAX_SUGGESTIONS) break
  }

  return { summary: clip(cleanSummary, MAX_SUMMARY), suggestions }
}

/**
 * 拼 prompt。
 *
 * 只放聚合数字，**不放昵称、不放手机号、不放具体词条名**。
 * 模型厂商收到的应该是"24 个词条、78% 正确率"，而不是"某个孩子"的信息。
 *
 * 「情景挑战没玩过」单独写一句提醒：不写 0%，否则模型爱顺着说"正确率 0%"。
 */
export function buildAiPrompt(stats: ReportStats, weakness: ScenarioWeakness[]): string {
  const lines: string[] = [
    '下面是一个小学生在「雅言小筑」上的学习数据。这个网站用来辨析网络热梗、积累雅词（书面化的替代说法）、做情景挑战（在具体场合里判断该怎么说话）。',
    '',
    '【学习数据】',
    `- 浏览过的热梗词条：${stats.termCount} 个`,
    `- 展开过的雅词对照：${stats.elegantCount} 组`,
    `- 收藏的说法：${stats.favoriteCount} 条`,
  ]

  if (stats.quizRounds > 0) {
    lines.push(`- 情景挑战：完成 ${stats.quizRounds} 轮，各轮平均正确率 ${stats.quizAvgAccuracy}%`)
  } else {
    lines.push('- 情景挑战：还没有玩过（因此没有任何正确率数据，不要提正确率）')
  }

  lines.push(
    `- 连续学习：${stats.streak} 天；累计有学习记录的天数：${stats.activeDays} 天`,
    `- 获得徽章：${stats.badgeCount} 枚；累计积分：${stats.totalPoints} 分`,
  )

  const wrongItems = weakness.filter((w) => w.wrong > 0)
  if (wrongItems.length > 0) {
    lines.push('', '【最近几轮的错题分布（情景类型：错题数 / 总题数）】')
    for (const w of wrongItems) {
      lines.push(`- ${w.scenarioType}：${w.wrong} / ${w.total}`)
    }
  } else if (weakness.length > 0) {
    lines.push('', '【最近的错题分布】近期没有错题。')
  }

  lines.push(
    '',
    '【写作要求，必须全部遵守】',
    '1. 读者是家长。语气平和、具体，像老师在群里随口说的一句话，不要鼓励式套话。',
    '2. 至少引用两个上面出现的具体数字，不要写"表现不错"这种没信息量的话。',
    '3. 不许出现对孩子或家长的负面评价词：太差、很差、落后、不如别人、笨、懒、糟糕、没救。',
    '4. 情景挑战轮次为 0 时，任何一句都不许提正确率，也不许说"没有练习""不认真"。',
    '5. 不称呼孩子姓名，统一用"孩子"。',
    '6. summary 是总评，60–100 字，一段话，不分点，不用 Markdown，不用换行。',
    '7. suggestions 是 2–3 条建议，每条 20–40 字，必须是家长当天就能做的小事；' +
      '不要"多读书""多练习""多加鼓励"这类空建议。',
    '8. 只输出 JSON，不要代码块标记，不要任何解释：',
    '{"summary":"……","suggestions":["……","……"]}',
  )

  return lines.join('\n')
}

/**
 * 演示通道的内容：本地规则现编。
 *
 * 为什么不直接复用 `buildReportText` 的三段文案：那样 AI 卡片和上面的
 * "给家长的建议"会几乎重复，看不出这一块是干什么的。这里换一种口吻——
 * 先说整体情况，再给一条有针对性的建议，模拟"老师看完数据顺口说的一段话"。
 */
export function buildMockOutput(stats: ReportStats, weakness: ScenarioWeakness[]): string {
  const progress: string[] = []
  if (stats.termCount > 0) progress.push(`翻过 ${stats.termCount} 个热梗`)
  if (stats.elegantCount > 0) progress.push(`展开 ${stats.elegantCount} 组雅词`)
  if (stats.quizRounds > 0) {
    progress.push(`做了 ${stats.quizRounds} 轮情景挑战、平均正确率 ${stats.quizAvgAccuracy}%`)
  }

  const doing =
    progress.length > 0 ? `孩子这段时间${progress.join('，')}。` : '孩子的账号还没有留下学习记录。'

  let comment: string
  if (stats.quizRounds === 0) {
    comment = '接下来最值得补的是情景挑战，光知道"不能说"不够，在具体场合里选一次才知道会不会用。'
  } else if (stats.quizAvgAccuracy >= 90) {
    comment = '这个判断力已经很稳了，可以开始往"说得更得体"上走。'
  } else if (stats.quizAvgAccuracy >= 75) {
    comment = '大部分场合都能选对，偶尔会在两个相近的说法之间犹豫。'
  } else {
    comment = '有几次是凭感觉选的，先把对应词条的解析看一遍再闯，会顺很多。'
  }

  const suggestions: string[] = []
  const worst = weakness.find((w) => w.wrong > 0)
  if (worst) {
    suggestions.push(`陪孩子把「${worst.scenarioType}」的错题过一遍，问他当时为什么选那个说法。`)
  }
  if (stats.elegantCount < 10) {
    suggestions.push('每天晚饭后花十分钟，一起展开两三组雅词，替换的说法是一点点攒起来的。')
  } else if (stats.favoriteCount < 5) {
    suggestions.push('让孩子把顺口的说法收藏起来，收藏夹会慢慢变成他自己的小词库。')
  } else {
    suggestions.push('让孩子试着把收藏的雅词用进当天的日记或作文里，用过一次才记得住。')
  }
  suggestions.push('周末问一句"这周学到的哪个词最好用"，比检查分数更容易聊开。')

  return JSON.stringify({ summary: doing + comment, suggestions })
}
