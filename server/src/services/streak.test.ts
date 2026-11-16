import { describe, expect, it } from 'vitest'
import { calcStreak, dateKey, shiftDay, toDateKeys } from './streak'

/**
 * 连续天数。这是全项目日期逻辑最容易错的地方，所以单独测。
 * 重点不是"正常情况能算对"，而是月底/年底/今天还没学时会不会崩。
 */
describe('calcStreak', () => {
  it('没有任何记录 → 0', () => {
    expect(calcStreak([], '2026-11-16')).toBe(0)
  })

  it('只有今天 → 1', () => {
    expect(calcStreak(['2026-11-16'], '2026-11-16')).toBe(1)
  })

  it('今天 + 昨天 → 2', () => {
    expect(calcStreak(['2026-11-16', '2026-11-15'], '2026-11-16')).toBe(2)
  })

  it('今天还没学、昨天学了 → 从昨天数起，不算断', () => {
    // 昨晚学到 11 点，今早打开网站。显示 0 天会让人以为自己白攒了
    expect(calcStreak(['2026-11-15', '2026-11-14'], '2026-11-16')).toBe(2)
  })

  it('今天和昨天都没有 → 0（真的断了）', () => {
    expect(calcStreak(['2026-11-14', '2026-11-13'], '2026-11-16')).toBe(0)
  })

  it('中间断一天，只数到断点', () => {
    expect(calcStreak(['2026-11-16', '2026-11-15', '2026-11-13'], '2026-11-16')).toBe(2)
  })

  it('跨月不会算错（2026-03-01 往前是 02-28）', () => {
    expect(calcStreak(['2026-03-01', '2026-02-28', '2026-02-27'], '2026-03-01')).toBe(3)
  })

  it('跨年不会算错（2026-01-01 往前是 2025-12-31）', () => {
    expect(calcStreak(['2026-01-01', '2025-12-31', '2025-12-30'], '2026-01-01')).toBe(3)
  })

  it('闰年 2 月 29 日存在（2028 是闰年）', () => {
    expect(calcStreak(['2028-03-01', '2028-02-29', '2028-02-28'], '2028-03-01')).toBe(3)
  })

  it('重复日期只算一天', () => {
    expect(calcStreak(['2026-11-16', '2026-11-16', '2026-11-15'], '2026-11-16')).toBe(2)
  })

  it('乱序输入结果一致', () => {
    const dates = ['2026-11-14', '2026-11-16', '2026-11-15']
    expect(calcStreak(dates, '2026-11-16')).toBe(3)
  })

  it('连续 7 天正好是 7', () => {
    const days = new Array(7).fill(0).map((_, i) => shiftDay('2026-11-16', -i))
    expect(calcStreak(days, '2026-11-16')).toBe(7)
  })
})

describe('shiftDay', () => {
  it('往前一天', () => {
    expect(shiftDay('2026-11-01', -1)).toBe('2026-10-31')
  })
  it('往后一天', () => {
    expect(shiftDay('2025-12-31', 1)).toBe('2026-01-01')
  })
  it('跨闰年 2 月', () => {
    expect(shiftDay('2028-02-28', 1)).toBe('2028-02-29')
  })
})

describe('dateKey', () => {
  it('补零到两位', () => {
    expect(dateKey(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('toDateKeys', () => {
  it('去重并倒序', () => {
    const list = [
      new Date(2026, 10, 15, 9),
      new Date(2026, 10, 16, 20),
      new Date(2026, 10, 15, 22),
    ]
    expect(toDateKeys(list)).toEqual(['2026-11-16', '2026-11-15'])
  })
})
