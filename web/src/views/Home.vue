<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { apiGet } from '@/api/http'

const features = [
  { to: '/terms', title: '热梗辨析', desc: '这句话什么场合能说、什么场合不能说', icon: '🔍', tone: 'bg-primary-soft' },
  { to: '/elegant', title: '雅词积累', desc: '同一个意思，换一种更文雅的说法', icon: '✒️', tone: 'bg-accent/10' },
  { to: '/quiz', title: '情景挑战', desc: '在限时选择里练出语感', icon: '🎯', tone: 'bg-ok/10' },
  { to: '/report', title: '家校反馈', desc: '把学习情况生成一张图，给家长看', icon: '📊', tone: 'bg-primary-soft' },
]

const health = ref<'checking' | 'up' | 'down'>('checking')
const latency = ref(0)

onMounted(async () => {
  try {
    const r = await apiGet<{ db: string; dbLatencyMs: number }>('/health')
    health.value = r.db === 'up' ? 'up' : 'down'
    latency.value = r.dbLatencyMs
  } catch {
    health.value = 'down'
  }
})
</script>

<template>
  <div class="space-y-5">
    <section class="card bg-gradient-to-br from-primary-soft to-surface">
      <p class="chip mb-2">小学生语言素养养成</p>
      <h1 class="text-2xl font-bold leading-snug text-primary-deep">
        说得出热梗，也写得出好句子
      </h1>
      <p class="mt-2 text-sm leading-6 text-ink-weak">
        在这里认识网络热梗、学会恰当表达，再用情景挑战练一练。
      </p>
    </section>

    <section class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <RouterLink
        v-for="f in features"
        :key="f.to"
        :to="f.to"
        class="card flex items-start gap-3 transition hover:-translate-y-0.5 hover:shadow-float"
      >
        <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-btn text-xl" :class="f.tone">
          {{ f.icon }}
        </div>
        <div class="min-w-0">
          <h2 class="font-semibold">{{ f.title }}</h2>
          <p class="mt-1 text-sm leading-5 text-ink-weak">{{ f.desc }}</p>
        </div>
      </RouterLink>
    </section>

    <p class="text-center text-xs text-ink-weak">
      接口状态：
      <span v-if="health === 'checking'">检测中…</span>
      <span v-else-if="health === 'up'" class="text-ok">正常（数据库 {{ latency }}ms）</span>
      <span v-else class="text-bad">未连通 —— 请确认后端已启动</span>
    </p>
  </div>
</template>
