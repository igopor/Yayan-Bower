/**
 * 内容导入（T0.4）
 * 读 server/prisma/data/*.json → 结构检查 → 写库
 *
 * 只查"能不能读进来"，不评判内容好坏：答案分布、题目结构、措辞深度一概不管。
 */
import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import 'dotenv/config'

const prisma = new PrismaClient()
const DATA_DIR = path.resolve(process.cwd(), 'server/prisma/data')

interface RawTerm {
  seq: number
  name: string
  plainMeaning: string
  heuristicAnalysis: string
  isFeatured: boolean
  sort: number
  showInTerms: boolean
}
interface RawElegant {
  seq: number
  name: string
  termName?: string
  refined: { word: string; definition: string }[]
}
interface RawQuiz {
  seq: number
  scenarioType: string
  stem: string
  optionA: string
  optionB: string
  correctOption: string
  isReverse: boolean
  explanation: string
}
interface RawDaily {
  seq: number
  content: string
  source: string
  meaning: string
  themes: string
}

function readJson<T>(file: string): T {
  const p = path.join(DATA_DIR, file)
  if (!fs.existsSync(p)) throw new Error(`找不到数据文件：${p}`)
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as T
}

const errors: string[] = []
const warnings: string[] = []

/** S1–S6：不通过就中断，避免把脏数据写进库 */
function validate(
  terms: RawTerm[],
  elegant: RawElegant[],
  quiz: RawQuiz[],
  daily: RawDaily[],
  quizSize: number,
) {
  // S1 名称非空且唯一
  const seen = new Set<string>()
  for (const t of terms) {
    if (!t.name?.trim()) errors.push(`S1 热梗名称为空（seq=${t.seq}）`)
    else if (seen.has(t.name)) errors.push(`S1 热梗重名：${t.name}`)
    else seen.add(t.name)
  }

  // S2 三个展示字段齐全
  for (const t of terms) {
    if (!t.plainMeaning?.trim()) errors.push(`S2 通俗释义为空：${t.name}`)
    if (!t.heuristicAnalysis?.trim()) warnings.push(`S2 启发式解析为空：${t.name}`)
  }

  // S3 雅词恰好 2 条且都有释义
  for (const e of elegant) {
    const valid = (e.refined ?? []).filter((r) => r.word?.trim() && r.definition?.trim())
    if (valid.length !== 2) errors.push(`S3 雅词不是完整 2 条：${e.name}（实际 ${valid.length}）`)
  }

  // S4 答案只认 A/B，选项非空且不相同
  for (const q of quiz) {
    if (q.correctOption !== 'A' && q.correctOption !== 'B')
      errors.push(`S4 第 ${q.seq} 题答案不是 A/B：${q.correctOption}`)
    if (!q.optionA?.trim() || !q.optionB?.trim()) errors.push(`S4 第 ${q.seq} 题选项为空`)
    if (q.optionA?.trim() === q.optionB?.trim()) errors.push(`S4 第 ${q.seq} 题两个选项相同`)
    if (/网络热梗|文雅表达|热梗|雅词/.test(`${q.optionA}${q.optionB}`))
      warnings.push(`S4 第 ${q.seq} 题选项可能带类别标注（UI 会原样渲染）`)
  }

  // S5 题库够抽一轮
  if (quiz.length < quizSize)
    errors.push(`S5 题库仅 ${quiz.length} 题，不足一轮 ${quizSize} 题`)

  // S6 每日一句字段齐全、seq 唯一
  const seqs = new Set<number>()
  for (const d of daily) {
    if (!d.content?.trim() || !d.source?.trim() || !d.meaning?.trim())
      errors.push(`S6 每日一句字段为空（seq=${d.seq}）`)
    if (seqs.has(d.seq)) errors.push(`S6 每日一句 seq 重复：${d.seq}`)
    seqs.add(d.seq)
  }
}

async function main() {
  console.log('\n── 内容导入 ──────────────────────────')
  const terms = readJson<RawTerm[]>('terms.json')
  const elegant = readJson<RawElegant[]>('elegant.json')
  const quiz = readJson<RawQuiz[]>('quiz.json')
  const daily = readJson<RawDaily[]>('daily-sentence.json')

  const quizSize = Number(process.env.QUIZ_SIZE ?? 20)
  validate(terms, elegant, quiz, daily, quizSize)

  if (warnings.length) {
    console.log(`\n⚠ ${warnings.length} 条提醒（不影响入库）：`)
    warnings.slice(0, 10).forEach((w) => console.log('   ', w))
    if (warnings.length > 10) console.log(`    …还有 ${warnings.length - 10} 条`)
  }
  if (errors.length) {
    console.error(`\n✗ 结构检查未通过（${errors.length} 项），已中止：`)
    errors.slice(0, 20).forEach((e) => console.error('   ', e))
    process.exit(1)
  }
  console.log('✓ 结构检查 S1–S6 通过')

  // 清空内容表（不动用户数据以外的表；练习会话与积分也会被牵连，故一并清）
  await prisma.$transaction([
    prisma.quizSessionItem.deleteMany(),
    prisma.quizSession.deleteMany(),
    prisma.favorite.deleteMany(),
    prisma.elegantPair.deleteMany(),
    prisma.term.deleteMany(),
    prisma.quizQuestion.deleteMany(),
    prisma.dailySentence.deleteMany(),
  ])

  // 1) 热梗
  await prisma.term.createMany({
    data: terms.map((t) => ({
      name: t.name,
      plainMeaning: t.plainMeaning,
      heuristicAnalysis: t.heuristicAnalysis,
      isFeatured: t.isFeatured,
      sort: t.sort,
      showInTerms: true,
      hasElegant: false,
    })),
  })
  console.log(`   term             +${terms.length}`)

  // 2) 雅词（未命中的热梗自动补一条 showInTerms=false 的主表记录）
  let created = 0
  let linked = 0
  for (const e of elegant) {
    const target = e.termName ?? e.name
    let term = await prisma.term.findUnique({ where: { name: target } })
    if (!term) {
      term = await prisma.term.create({
        data: { name: target, showInTerms: false, hasElegant: true, sort: 999 },
      })
      created++
    } else {
      linked++
      await prisma.term.update({ where: { id: term.id }, data: { hasElegant: true } })
    }
    await prisma.elegantPair.create({
      data: {
        termId: term.id,
        word1: e.refined[0].word,
        def1: e.refined[0].definition,
        word2: e.refined[1].word,
        def2: e.refined[1].definition,
      },
    })
  }
  console.log(`   elegant_pair     +${elegant.length}（命中主表 ${linked}，新建仅雅词 ${created}）`)

  // 3) 情景题
  await prisma.quizQuestion.createMany({
    data: quiz.map((q) => ({
      seq: q.seq,
      scenarioType: q.scenarioType,
      stem: q.stem,
      optionA: q.optionA,
      optionB: q.optionB,
      correctOption: q.correctOption,
      isReverse: q.isReverse,
      explanation: q.explanation,
    })),
  })
  console.log(`   quiz_question    +${quiz.length}`)

  // 4) 每日一句
  await prisma.dailySentence.createMany({
    data: daily.map((d) => ({
      seq: d.seq,
      content: d.content,
      source: d.source,
      meaning: d.meaning,
      themes: d.themes ?? '',
    })),
  })
  console.log(`   daily_sentence   +${daily.length}`)

  // 汇总
  const [tc, ec, qc, dc] = await Promise.all([
    prisma.term.count(),
    prisma.elegantPair.count(),
    prisma.quizQuestion.count(),
    prisma.dailySentence.count(),
  ])
  console.log('\n── 入库结果 ──────────────────────────')
  console.log(`   term            ${tc}`)
  console.log(`   elegant_pair    ${ec}`)
  console.log(`   quiz_question   ${qc}`)
  console.log(`   daily_sentence  ${dc}`)
  console.log('\n完成。\n')
}

main()
  .catch((e) => {
    console.error('\n导入失败：', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
