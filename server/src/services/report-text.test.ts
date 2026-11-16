import { describe, expect, it } from 'vitest'
import { buildReportText, type ReportStats } from '../../../shared/index'

/**
 * 三段小结文案。
 *
 * 这组测试的核心不是"某个数字对应某句话"，而是**穷举数据组合不出硬伤**。
 * 自动生成的家长报告最典型的翻车是："本轮正确率 0%，表现很棒！"
 * 一句话就能让家长觉得这产品在敷衍。
 */

function stats(patch: Partial<ReportStats> = {}): ReportStats {
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
    generatedAt: '2026-11-16T08:00:00.000Z',
    ...patch,
  }
}

/** 三段合并成一个数组，方便逐句检查 */
function allText(s: ReportStats): string[] {
  const t = buildReportText(s)
  return [...t.strengths, ...t.improvements, ...t.advice]
}

describe('buildReportText', () => {
  it('完全没有数据时三段都不空，且不出现硬伤', () => {
    const text = buildReportText(stats())
    expect(text.strengths.length).toBeGreaterThan(0)
    expect(text.improvements.length).toBeGreaterThan(0)
    expect(text.advice.length).toBeGreaterThan(0)
    // 一轮都没闯过时，任何一句都不许提正确率
    for (const line of allText(stats())) {
      expect(line).not.toMatch(/正确率/)
      expect(line).not.toMatch(/0%/)
    }
  })

  it('一轮都没闯过时绝不提正确率（哪怕其它数据很多）', () => {
    const s = stats({ termCount: 40, elegantCount: 30, favoriteCount: 25, streak: 10, totalPoints: 600 })
    for (const line of allText(s)) expect(line).not.toMatch(/正确率/)
  })

  it('高数据时优势段先讲正确率，且不超过上限', () => {
    const s = stats({ quizRounds: 5, quizAvgAccuracy: 95, termCount: 30, streak: 9, favoriteCount: 21 })
    const text = buildReportText(s)
    expect(text.strengths[0]).toMatch(/95%/)
    expect(text.strengths.length).toBeLessThanOrEqual(3)
  })

  it('正确率低于 60 时不把它写进优势段', () => {
    const s = stats({ quizRounds: 3, quizAvgAccuracy: 40 })
    const text = buildReportText(s)
    expect(text.strengths.join('')).not.toMatch(/40%/)
    // 但待加强段要说清楚
    expect(text.improvements.join('')).toMatch(/40%/)
  })

  it('任意数据组合都不出现 NaN / undefined / 空句子', () => {
    // 逐个 expect 太慢（几千次组合 × 每段若干句），
    // 所以每个组合只把问题汇总成两三条断言：哪一段空了、哪一句有脏值。
    const nums = [0, 1, 10, 30]
    const accs = [0, 45, 85, 100]
    const problems: string[] = []

    for (const termCount of nums) {
      for (const elegantCount of nums) {
        for (const favoriteCount of nums) {
          for (const quizRounds of [0, 1]) {
            for (const quizAvgAccuracy of accs) {
              for (const streak of [0, 2, 7]) {
                const s = stats({
                  termCount,
                  elegantCount,
                  favoriteCount,
                  quizRounds,
                  quizAvgAccuracy,
                  streak,
                })
                const text = buildReportText(s)
                const tag = JSON.stringify({ termCount, elegantCount, favoriteCount, quizRounds, quizAvgAccuracy, streak })

                if (!text.strengths.length) problems.push(`优势段为空 ${tag}`)
                if (!text.improvements.length) problems.push(`待加强段为空 ${tag}`)
                if (!text.advice.length) problems.push(`建议段为空 ${tag}`)

                for (const line of allText(s)) {
                  if (line.trim().length <= 5) problems.push(`句子过短 ${tag}：${line}`)
                  if (/NaN|undefined|null|Infinity/.test(line)) problems.push(`脏值 ${tag}：${line}`)
                }
              }
            }
          }
        }
      }
    }

    expect(problems.slice(0, 5)).toEqual([])
  })

  it('没闯过关时，正确率这个数字不会以 0% 的形式出现在任何一句里', () => {
    for (const termCount of [0, 1, 50]) {
      for (const streak of [0, 3, 15]) {
        const s = stats({ termCount, streak, quizRounds: 0, quizAvgAccuracy: 0 })
        for (const line of allText(s)) expect(line).not.toMatch(/%/)
      }
    }
  })
})
