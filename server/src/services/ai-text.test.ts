import { describe, expect, it } from 'vitest'
import type { ReportStats } from '../../../shared/index'
import {
  MAX_SUGGESTIONS,
  MAX_SUMMARY,
  RISKY_WORDS,
  buildAiPrompt,
  buildMockOutput,
  sanitizeAiOutput,
  statsSignature,
} from './ai-text'
import type { ScenarioWeakness } from './stats'

/**
 * AI 小结的文本规则单测。
 *
 * 为什么值得写（而不是"看着能跑"）：这一段文字直接进给家长看的图片。
 * 模型不守格式、说出"太差了"、或者在一轮没闯过时提到"0% 正确率"，
 * 都是上线后才可能发现、被家长截图后无法挽回的问题。
 * 这里全部是纯函数，跑几百组组合不到一秒。
 */

function makeStats(p: Partial<ReportStats> = {}): ReportStats {
  return {
    nickname: '小雅士',
    termCount: 0,
    elegantCount: 0,
    favoriteCount: 0,
    quizRounds: 0,
    quizAvgAccuracy: 0,
    streak: 0,
    activeDays: 0,
    badgeCount: 0,
    totalPoints: 0,
    generatedAt: '2026-11-25T00:00:00.000Z',
    ...p,
  }
}

const NO_WEAKNESS: ScenarioWeakness[] = []

describe('sanitizeAiOutput', () => {
  it('正常 JSON：结构原样取出', () => {
    const r = sanitizeAiOutput('{"summary":"孩子这段时间翻过 12 个热梗。","suggestions":["陪他做一轮闯关","收藏三个顺口的说法"]}')
    expect(r).not.toBeNull()
    expect(r!.summary).toBe('孩子这段时间翻过 12 个热梗。')
    expect(r!.suggestions).toHaveLength(2)
  })

  it('被代码块包着也能解析（模型最常见的越界方式）', () => {
    const r = sanitizeAiOutput('```json\n{"summary":"翻过 12 个热梗。","suggestions":["陪他闯一轮"]}\n```')
    expect(r!.summary).toBe('翻过 12 个热梗。')
    expect(r!.suggestions).toEqual(['陪他闯一轮'])
  })

  it('完全不是 JSON：整段当总评，不丢内容', () => {
    const r = sanitizeAiOutput('孩子这段时间翻过 12 个热梗，建议陪他做一轮情景挑战。')
    expect(r!.summary).toContain('翻过 12 个热梗')
    expect(r!.suggestions).toEqual([])
  })

  it('空内容返回 null（交给上层降级，不显示卡片）', () => {
    expect(sanitizeAiOutput('   ')).toBeNull()
    expect(sanitizeAiOutput('{"summary":"","suggestions":[]}')).toBeNull()
  })

  it('总评命中风险词 → 整段作废', () => {
    for (const word of RISKY_WORDS) {
      expect(sanitizeAiOutput(`{"summary":"这孩子${word}。","suggestions":[]}`)).toBeNull()
    }
  })

  it('单条建议命中风险词 → 只丢这一条，保留其余', () => {
    const r = sanitizeAiOutput(
      '{"summary":"翻过 12 个热梗。","suggestions":["孩子有点懒，多催催","陪他做一轮情景挑战"]}',
    )
    expect(r!.suggestions).toEqual(['陪他做一轮情景挑战'])
  })

  it('建议最多留 3 条', () => {
    const r = sanitizeAiOutput(
      '{"summary":"翻过 12 个热梗。","suggestions":["第一条建议内容较长","第二条建议内容较长","第三条建议内容较长","第四条建议内容较长","第五条建议内容较长"]}',
    )
    expect(r!.suggestions).toHaveLength(MAX_SUGGESTIONS)
  })

  it('建议去重、丢掉过短的碎片', () => {
    const r = sanitizeAiOutput(
      '{"summary":"翻过 12 个热梗。","suggestions":["陪他做一轮情景挑战","陪他做一轮情景挑战","多读","陪他展开两组雅词"]}',
    )
    expect(r!.suggestions).toEqual(['陪他做一轮情景挑战', '陪他展开两组雅词'])
  })

  it('清掉 Markdown 标记与换行', () => {
    const r = sanitizeAiOutput('{"summary":"**翻过 12 个热梗。**\\n- 做得不错","suggestions":[]}')
    expect(r!.summary).toBe('翻过 12 个热梗。 做得不错')
    expect(r!.summary).not.toContain('*')
    expect(r!.summary).not.toContain('\n')
  })

  it('超长总评截断到句读处并加省略号', () => {
    const long = '孩子这段时间表现稳定。'.repeat(30)
    const r = sanitizeAiOutput(JSON.stringify({ summary: long, suggestions: [] }))
    expect(r!.summary.length).toBeLessThanOrEqual(MAX_SUMMARY + 1)
    expect(r!.summary.endsWith('…')).toBe(true)
  })

  it('非字符串 / 非数组的字段一律忽略，不抛异常', () => {
    const r = sanitizeAiOutput('{"summary":"翻过 12 个热梗。","suggestions":"不是数组"}')
    expect(r!.suggestions).toEqual([])
  })
})

describe('buildAiPrompt', () => {
  it('只放聚合数字，不放昵称与手机号', () => {
    const prompt = buildAiPrompt(makeStats({ nickname: '张三', termCount: 9 }), NO_WEAKNESS)
    expect(prompt).toContain('9 个')
    expect(prompt).not.toContain('张三')
    expect(prompt).not.toMatch(/1[3-9]\d{9}/)
  })

  it('没闯过关时：明确要求不提正确率，且不出现 0%', () => {
    const prompt = buildAiPrompt(makeStats({ quizRounds: 0 }), NO_WEAKNESS)
    expect(prompt).toContain('不要提正确率')
    expect(prompt).not.toContain('0%')
  })

  it('有错题时带上类型分布（这是"建议不空泛"的来源）', () => {
    const prompt = buildAiPrompt(makeStats({ quizRounds: 2, quizAvgAccuracy: 70 }), [
      { scenarioType: '书面写作', wrong: 3, total: 5 },
      { scenarioType: '课堂表达', wrong: 0, total: 4 },
    ])
    expect(prompt).toContain('书面写作：3 / 5')
    expect(prompt).not.toContain('课堂表达')
  })

  it('写作约束齐全：负面词清单、不用 Markdown、只输出 JSON', () => {
    const prompt = buildAiPrompt(makeStats(), NO_WEAKNESS)
    for (const w of RISKY_WORDS.slice(0, 5)) expect(prompt).toContain(w)
    expect(prompt).toContain('只输出 JSON')
    expect(prompt).toContain('不用 Markdown')
  })
})

describe('buildMockOutput（演示通道）', () => {
  const combos: ReportStats[] = []
  for (const termCount of [0, 1, 12, 30]) {
    for (const elegantCount of [0, 3, 15]) {
      for (const favoriteCount of [0, 7]) {
        for (const quizRounds of [0, 1, 4]) {
          for (const accuracy of quizRounds === 0 ? [0] : [40, 60, 78, 95]) {
            for (const streak of [0, 3, 9]) {
              combos.push(
                makeStats({
                  termCount,
                  elegantCount,
                  favoriteCount,
                  quizRounds,
                  quizAvgAccuracy: accuracy,
                  streak,
                  activeDays: streak,
                  badgeCount: Math.min(6, quizRounds),
                  totalPoints: termCount * 2 + quizRounds * 10,
                }),
              )
            }
          }
        }
      }
    }
  }

  it('每种组合都能解析、总评非空（' + combos.length + ' 组）', () => {
    for (const stats of combos) {
      const r = sanitizeAiOutput(buildMockOutput(stats, NO_WEAKNESS))
      expect(r, JSON.stringify(stats)).not.toBeNull()
      expect(r!.summary.length).toBeGreaterThan(4)
    }
  })

  it('没闯过关的组合，一个"正确率"都不许出现', () => {
    for (const stats of combos) {
      if (stats.quizRounds > 0) continue
      const out = buildMockOutput(stats, NO_WEAKNESS)
      expect(out, JSON.stringify(stats)).not.toContain('正确率')
    }
  })

  it('任何组合都不含风险词、不含 0% 这种硬伤', () => {
    for (const stats of combos) {
      const out = buildMockOutput(stats, NO_WEAKNESS)
      for (const w of RISKY_WORDS) expect(out).not.toContain(w)
      if (stats.quizRounds === 0) expect(out).not.toContain('0%')
    }
  })

  it('有错题类型时，建议里会点名那一类', () => {
    const out = buildMockOutput(makeStats({ quizRounds: 2, quizAvgAccuracy: 70 }), [
      { scenarioType: '书面写作', wrong: 4, total: 6 },
    ])
    expect(out).toContain('书面写作')
  })

  it('零记录也能给出一句像样的话，不是空白卡片', () => {
    const stats = makeStats()
    expect(buildMockOutput(stats, NO_WEAKNESS)).toContain('还没有留下学习记录')
  })
})

describe('statsSignature', () => {
  it('数字不变则指纹不变（用于判断能不能复用当天缓存）', () => {
    const a = statsSignature(makeStats({ termCount: 5 }))
    const b = statsSignature(makeStats({ termCount: 5, generatedAt: '2030-01-01T00:00:00.000Z' }))
    expect(a).toBe(b)
  })

  it('任一关键数字变化都会改变指纹', () => {
    const base = makeStats({ termCount: 5 })
    expect(statsSignature(base)).not.toBe(statsSignature({ ...base, termCount: 6 }))
    expect(statsSignature(base)).not.toBe(statsSignature({ ...base, quizAvgAccuracy: 80 }))
  })
})
