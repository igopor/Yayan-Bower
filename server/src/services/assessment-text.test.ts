import { describe, expect, it } from 'vitest'
import { ASSESS_DIMENSIONS } from '../../../shared/assessment'
import { charLen, mockAssessment, sanitizeResult, validateText } from './assessment-text'

/**
 * 语言测评的三条纯规则：字数校验、模型输出清洗、演示通道文案。
 *
 * 只测纯函数，不碰 env / prisma / 网络——这样一条命令跑完，不需要起服务、不需要 key。
 * 断言的是"结构对不对、边界守不守"，不断言具体措辞（措辞是模型和文案的事）。
 */

const MAX = 300

/** 刚好 n 个汉字 */
function han(n: number, ch = '好'): string {
  return ch.repeat(n)
}

describe('validateText 字数与隐私校验', () => {
  it('空字符串 → 提示先写一段话', () => {
    const r = validateText('', { maxChars: MAX })
    expect(r.ok).toBe(false)
    expect(r).toMatchObject({ message: '请先写一段话再提交' })
  })

  it('只有空白字符也算空', () => {
    expect(validateText('   \n\t ', { maxChars: MAX }).ok).toBe(false)
  })

  it('非字符串（undefined / 数字）按空处理，不抛错', () => {
    expect(validateText(undefined, { maxChars: MAX }).ok).toBe(false)
    expect(validateText(123, { maxChars: MAX }).ok).toBe(false)
  })

  it('29 字被拒，提示还差几个字的意思', () => {
    const r = validateText(han(29), { maxChars: MAX })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('30')
  })

  it('30 字通过（下边界）', () => {
    expect(validateText(han(30), { maxChars: MAX }).ok).toBe(true)
  })

  it('300 字通过（上边界）', () => {
    expect(validateText(han(300), { maxChars: MAX }).ok).toBe(true)
  })

  it('301 字被拒，提示上限', () => {
    const r = validateText(han(301), { maxChars: MAX })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('300')
  })

  it('首尾空白不计入字数', () => {
    expect(validateText(`   ${han(30)}   `, { maxChars: MAX }).ok).toBe(true)
  })

  it('emoji 按码点算一个字，不会因为代理对多算', () => {
    expect(charLen('😀')).toBe(1)
    // 29 个 emoji 是 29 字，不是 58
    expect(validateText('😀'.repeat(29), { maxChars: MAX }).ok).toBe(false)
    expect(validateText('😀'.repeat(30), { maxChars: MAX }).ok).toBe(true)
  })

  it('含 11 位手机号被拦，提示不要写个人信息', () => {
    const text = '我妈妈的手机号是13800000000，她说周末带我去公园玩，还可以带风筝。'
    const r = validateText(text, { maxChars: MAX })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('个人信息')
  })

  it('13 位连续数字不会被截出 11 位来误拦', () => {
    const text = `我的订单号是1234567890123，我买了三本书，其中一本讲的是恐龙。`
    expect(validateText(text, { maxChars: MAX }).ok).toBe(true)
  })

  it('通过时返回 trim 后的文本', () => {
    const r = validateText(`  ${han(30)}  `, { maxChars: MAX })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.text).toBe(han(30))
  })
})

/* ── 构造模型输出 ── */

function dim(key: string, over: Record<string, unknown> = {}) {
  return {
    key,
    level: '不错',
    comment: '这句话读起来挺顺的。',
    evidence: '',
    advice: '下次可以把细节写得更具体一点。',
    ...over,
  }
}

function raw(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    overall: {
      level: '不错',
      summary: '这段话能把一件事说明白，句子之间也接得上。',
      suggestions: ['把当时的心情写出来', '读一遍听听哪里不顺'],
    },
    dimensions: [dim('vocabulary'), dim('fluency'), dim('richness'), dim('cohesion')],
    ...over,
  })
}

const ORIGINAL = '今天我和妈妈去公园放风筝，风很大，风筝一下就飞起来了。'

describe('sanitizeResult 输出清洗', () => {
  it('合法 JSON → 四维齐全、顺序固定', () => {
    const r = sanitizeResult(raw(), ORIGINAL)
    expect(r).not.toBeNull()
    expect(r!.dimensions.map((d) => d.key)).toEqual(ASSESS_DIMENSIONS.map((d) => d.key))
    expect(r!.overall.summary.length).toBeGreaterThan(4)
    expect(r!.overall.suggestions.length).toBe(2)
  })

  it('```json 代码块包裹也能解析', () => {
    expect(sanitizeResult('```json\n' + raw() + '\n```', ORIGINAL)).not.toBeNull()
  })

  it('前后带解释文字也能解析（取第一个 { 到最后一个 }）', () => {
    const messy = `好的，分析如下：\n${raw()}\n希望有帮助。`
    expect(sanitizeResult(messy, ORIGINAL)).not.toBeNull()
  })

  it('完全不是 JSON → null', () => {
    expect(sanitizeResult('我觉得写得还不错，继续加油。', ORIGINAL)).toBeNull()
  })

  it('只有三维 → null（缺一维的卡片是残的，不如不显示）', () => {
    const bad = raw({ dimensions: [dim('vocabulary'), dim('fluency'), dim('richness')] })
    expect(sanitizeResult(bad, ORIGINAL)).toBeNull()
  })

  it('五维 → null', () => {
    const bad = raw({
      dimensions: [
        dim('vocabulary'),
        dim('fluency'),
        dim('richness'),
        dim('cohesion'),
        dim('vocabulary'),
      ],
    })
    expect(sanitizeResult(bad, ORIGINAL)).toBeNull()
  })

  it('出现未知 key → null', () => {
    const bad = raw({
      dimensions: [dim('vocabulary'), dim('fluency'), dim('richness'), dim('spelling')],
    })
    expect(sanitizeResult(bad, ORIGINAL)).toBeNull()
  })

  it('重复 key（用重复顶替缺失）→ null', () => {
    const bad = raw({
      dimensions: [dim('vocabulary'), dim('vocabulary'), dim('richness'), dim('cohesion')],
    })
    expect(sanitizeResult(bad, ORIGINAL)).toBeNull()
  })

  it('level 不在三档内 → 该维降为「再练练」，整体仍可用', () => {
    const bad = raw({
      dimensions: [
        dim('vocabulary', { level: '超级棒' }),
        dim('fluency'),
        dim('richness'),
        dim('cohesion'),
      ],
    })
    const r = sanitizeResult(bad, ORIGINAL)
    expect(r).not.toBeNull()
    expect(r!.dimensions[0].level).toBe('再练练')
  })

  it('evidence 是原文里的句子 → 保留', () => {
    const ok = raw({
      dimensions: [
        dim('vocabulary', { evidence: '风筝一下就飞起来了' }),
        dim('fluency'),
        dim('richness'),
        dim('cohesion'),
      ],
    })
    const r = sanitizeResult(ok, ORIGINAL)
    expect(r!.dimensions[0].evidence).toBe('风筝一下就飞起来了')
  })

  it('evidence 与原文只差标点 → 仍然保留（核验时去标点比较）', () => {
    const ok = raw({
      dimensions: [
        dim('vocabulary', { evidence: '风很大，风筝一下就飞起来了' }),
        dim('fluency'),
        dim('richness'),
        dim('cohesion'),
      ],
    })
    // 原文这句的标点是"，"，evidence 里改成了"，"——去标点后一致，不该判为编造
    expect(sanitizeResult(ok, ORIGINAL)!.dimensions[0].evidence).not.toBe('')
  })

  it('evidence 是模型编的句子 → 清空，不报错', () => {
    const bad = raw({
      dimensions: [
        dim('vocabulary', { evidence: '我们一路唱着歌走回家' }),
        dim('fluency'),
        dim('richness'),
        dim('cohesion'),
      ],
    })
    const r = sanitizeResult(bad, ORIGINAL)
    expect(r).not.toBeNull()
    expect(r!.dimensions[0].evidence).toBe('')
  })

  it('summary 为空 → 整块 null（不能把 JSON 原文贴给用户）', () => {
    expect(sanitizeResult(raw({ overall: { level: '不错', summary: '', suggestions: [] } }), ORIGINAL)).toBeNull()
  })

  it('summary 缺失 → null', () => {
    expect(sanitizeResult(raw({ overall: { level: '不错', suggestions: [] } }), ORIGINAL)).toBeNull()
  })

  it('suggestions 超过 3 条 → 截到 3 条', () => {
    const many = raw({
      overall: {
        level: '不错',
        summary: '这段话能把一件事说明白。',
        suggestions: ['第一条建议', '第二条建议', '第三条建议', '第四条建议'],
      },
    })
    expect(sanitizeResult(many, ORIGINAL)!.overall.suggestions.length).toBe(3)
  })

  it('summary 超 80 字 → 截断', () => {
    const long = raw({
      overall: { level: '不错', summary: han(120, '长'), suggestions: [] },
    })
    expect(charLen(sanitizeResult(long, ORIGINAL)!.overall.summary)).toBeLessThanOrEqual(80)
  })

  it('模型把手机号写进评语 → 整块 null（只拦这一种，不做敏感词库）', () => {
    const bad = raw({
      overall: { level: '不错', summary: '写得好，有事可以打 13800000000。', suggestions: [] },
    })
    expect(sanitizeResult(bad, ORIGINAL)).toBeNull()
  })
})

describe('mockAssessment 演示通道', () => {
  const A = '今天我和妈妈去公园放风筝。因为风很大，所以风筝一下就飞起来了。后来线缠住了，我慢慢解开。最后风筝飞得比树还高。'
  const B = '我喜欢小狗。小狗很可爱。小狗会跑。小狗会叫。小狗会跳。'

  it('两段不同文本的输出不一样', () => {
    expect(JSON.stringify(mockAssessment(A))).not.toBe(JSON.stringify(mockAssessment(B)))
  })

  it('输出结构能通过 sanitizeResult（说明它就是真实路径的产物）', () => {
    const r = sanitizeResult(JSON.stringify(mockAssessment(A)), A)
    expect(r).not.toBeNull()
    expect(r!.dimensions).toHaveLength(4)
  })

  it('连接词多的那段，连贯维度不低于连接词少的', () => {
    const a = mockAssessment(A).dimensions.find((d) => d.key === 'cohesion')!
    const b = mockAssessment(B).dimensions.find((d) => d.key === 'cohesion')!
    const rank = { 再练练: 0, 不错: 1, 很棒: 2 } as const
    expect(rank[a.level]).toBeGreaterThanOrEqual(rank[b.level])
  })

  it('evidence 都是从原文里切出来的（不会凭空造句子）', () => {
    for (const d of mockAssessment(A).dimensions) {
      if (!d.evidence) continue
      expect(A.replace(/[，。；、！？]/g, '')).toContain(d.evidence.replace(/[，。；、！？]/g, ''))
    }
  })

  it('总评里带上了句数与连接词数，不是空话', () => {
    const s = mockAssessment(A).overall.summary
    expect(s).toMatch(/\d+\s*句/)
    expect(s).toMatch(/\d+\s*个连接词/)
  })

  it('三档等级都在枚举内', () => {
    for (const t of [A, B, han(60)]) {
      const r = mockAssessment(t)
      expect(['很棒', '不错', '再练练']).toContain(r.overall.level)
      for (const d of r.dimensions) expect(['很棒', '不错', '再练练']).toContain(d.level)
    }
  })
})
