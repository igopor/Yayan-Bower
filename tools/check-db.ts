import { PrismaClient } from '@prisma/client'

const p = new PrismaClient()

async function main() {
  const total = await p.term.count()
  const feat = await p.term.count({ where: { isFeatured: true } })
  const inTerms = await p.term.count({ where: { showInTerms: true } })
  const onlyEl = await p.term.count({ where: { showInTerms: false } })
  const hasEl = await p.term.count({ where: { hasElegant: true } })
  const quizRev = await p.quizQuestion.count({ where: { isReverse: true } })
  const daily = await p.dailySentence.count()
  console.log({ total, feat, inTerms, onlyEl, hasEl, quizRev, daily })

  const s = await p.term.findFirst({ where: { name: 'yyds' }, include: { elegant: true } })
  console.log('联动示例:', s?.name, '->', s?.elegant?.word1, '/', s?.elegant?.word2)

  const orphan = await p.term.count({ where: { showInTerms: true, hasElegant: false } })
  console.log('有辨析无雅词:', orphan)

  await p.$disconnect()
}

void main()
