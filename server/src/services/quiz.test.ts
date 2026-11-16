import { describe, expect, it } from 'vitest'
import {
  PERFECT_ACCURACY,
  TIMEOUT_MS,
  accuracyOf,
  commentOf,
  judge,
  shuffle,
  tierOf,
  toDisplayPick,
  toOriginalPick,
} from './quiz'
import { QUIZ_PERFECT_RATE, QUIZ_SECONDS, QUIZ_TIMEOUT_TOLERANCE } from '../../../shared/index'

/**
 * 判分与分档的单测。全部是纯函数，不连数据库，跑一遍不到一毫秒。
 *
 * 这是整个项目第二处必须写单测的地方（第一处是积分内核）：
 * 判分写反了 → 答对被判错，孩子会觉得"这破网站乱判"，而自己测十次也未必撞上。
 */

describe('选项位置映射', () => {
  it('不交换时原样返回', () => {
    expect(toOriginalPick('A', false)).toBe('A')
    expect(toOriginalPick('B', false)).toBe('B')
    expect(toDisplayPick('A', false)).toBe('A')
  })

  it('交换时 A/B 互换', () => {
    expect(toOriginalPick('A', true)).toBe('B')
    expect(toOriginalPick('B', true)).toBe('A')
    expect(toDisplayPick('A', true)).toBe('B')
  })

  it('来回映射等于没映射（对两种交换状态都成立）', () => {
    for (const swap of [false, true]) {
      for (const p of ['A', 'B'] as const) {
        expect(toOriginalPick(toDisplayPick(p, swap), swap)).toBe(p)
        expect(toDisplayPick(toOriginalPick(p, swap), swap)).toBe(p)
      }
    }
  })
})

describe('判分', () => {
  it('不交换，点对了判对', () => {
    const r = judge({ pick: 'A', correctOption: 'A', displaySwap: false, elapsedMs: 3000 })
    expect(r.isCorrect).toBe(true)
    expect(r.timedOut).toBe(false)
    expect(r.chosen).toBe('A')
    expect(r.correctPick).toBe('A')
  })

  it('不交换，点错了判错', () => {
    const r = judge({ pick: 'B', correctOption: 'A', displaySwap: false, elapsedMs: 3000 })
    expect(r.isCorrect).toBe(false)
    expect(r.chosen).toBe('B')
  })

  it('交换后，屏幕上看着对的点判对（本题最容易写反的一处）', () => {
    // 题库答案是 B，但这题左右换了 → 屏幕 A 位放的其实是 B
    const r = judge({ pick: 'A', correctOption: 'B', displaySwap: true, elapsedMs: 2000 })
    expect(r.isCorrect).toBe(true)
    // 落到库里要存回原始位置 B，而不是屏幕位置 A
    expect(r.chosen).toBe('B')
    // 反馈要高亮的也是屏幕位置：原始 B 被换到了屏幕左边，即 A
    expect(r.correctPick).toBe('A')
  })

  it('交换后点错仍判错', () => {
    const r = judge({ pick: 'B', correctOption: 'B', displaySwap: true, elapsedMs: 2000 })
    expect(r.isCorrect).toBe(false)
  })

  it('没选（超时自动交卷）判错且标记超时', () => {
    const r = judge({ pick: null, correctOption: 'A', displaySwap: false, elapsedMs: 900 })
    expect(r.isCorrect).toBe(false)
    expect(r.timedOut).toBe(true)
    expect(r.chosen).toBeNull()
  })

  it('刚好卡在阈值上算答对，超 1 毫秒判错', () => {
    const base = { pick: 'A' as const, correctOption: 'A', displaySwap: false }
    expect(judge({ ...base, elapsedMs: TIMEOUT_MS }).isCorrect).toBe(true)
    expect(judge({ ...base, elapsedMs: TIMEOUT_MS + 1 }).isCorrect).toBe(false)
  })

  it('超时阈值 = 限时 + 宽限，宽限只为补网络往返', () => {
    expect(TIMEOUT_MS).toBe((QUIZ_SECONDS + QUIZ_TIMEOUT_TOLERANCE) * 1000)
  })

  it('超时就算点对了也算错（考的是限时反应）', () => {
    const r = judge({
      pick: 'A',
      correctOption: 'A',
      displaySwap: false,
      elapsedMs: TIMEOUT_MS + 5000,
    })
    expect(r.isCorrect).toBe(false)
    expect(r.timedOut).toBe(true)
  })
})

describe('正确率与分档', () => {
  it('10 题对 9 = 90，不是 89（用四舍五入不是截断）', () => {
    expect(accuracyOf(9, 10)).toBe(90)
    expect(accuracyOf(7, 10)).toBe(70)
    expect(accuracyOf(1, 3)).toBe(33)
  })

  it('零题不除零', () => {
    expect(accuracyOf(0, 0)).toBe(0)
  })

  it('分档边界：90 起优秀，70 起不错，69 落到继续练', () => {
    expect(tierOf(100)).toBe('great')
    expect(tierOf(90)).toBe('great')
    expect(tierOf(89)).toBe('good')
    expect(tierOf(70)).toBe('good')
    expect(tierOf(69)).toBe('keep')
    expect(tierOf(0)).toBe('keep')
  })

  it('每档都有评语，且评语里不出现具体数字（防止"0% 正确率很棒"这类硬伤）', () => {
    for (const t of ['great', 'good', 'keep'] as const) {
      const text = commentOf(t)
      expect(text.length).toBeGreaterThan(8)
      expect(text).not.toMatch(/%|正确率|积分|得分|\d/)
    }
  })

  it('额外加分的门槛与积分规则一致（≥80%）', () => {
    expect(PERFECT_ACCURACY).toBe(Math.round(QUIZ_PERFECT_RATE * 100))
  })
})

describe('洗牌', () => {
  const src = Array.from({ length: 23 }, (_, i) => i + 1)

  it('长度不变、元素不增不减', () => {
    const out = shuffle(src)
    expect(out).toHaveLength(src.length)
    expect([...out].sort((a, b) => a - b)).toEqual(src)
  })

  it('不改入参', () => {
    const copy = [...src]
    shuffle(src)
    expect(src).toEqual(copy)
  })

  it('23 个元素洗两次大概率不同（防止"根本没洗"的低级错误）', () => {
    const a = shuffle(src).join(',')
    const b = shuffle(src).join(',')
    // 理论上仍可能撞上同一个排列（概率 1/23!），实际不会
    expect(a).not.toBe(b)
  })
})
