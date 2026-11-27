<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { apiGet } from '@/api/http'
import { toast } from '@/composables/useToast'

interface Feature {
  to: string
  title: string
  desc: string
  icon: string
  tone: string
  /** 依赖 AI 通道的入口：通道关着时置灰，点进去也只会看到"暂时没开启" */
  needsAi?: boolean
}

const features: Feature[] = [
  { to: '/terms', title: '热梗辨析', desc: '这句话什么场合能说、什么场合不能说', icon: '🔍', tone: 'bg-primary-soft' },
  { to: '/elegant', title: '雅词积累', desc: '同一个意思，换一种更文雅的说法', icon: '✒️', tone: 'bg-accent/10' },
  { to: '/quiz', title: '情景挑战', desc: '在限时选择里练出语感', icon: '🎯', tone: 'bg-ok/10' },
  { to: '/report', title: '家校反馈', desc: '把学习情况生成一张图，给家长看', icon: '📊', tone: 'bg-primary-soft' },
  { to: '/assessment', title: '语言测评', desc: '写一段话，看看哪里棒、哪里还能更好', icon: '📝', tone: 'bg-accent/10', needsAi: true },
]

const health = ref<'checking' | 'up' | 'down'>('checking')
const latency = ref(0)
/** AI 通道是否可用。默认 true，只有明确拿到 false 才置灰，避免网络抖动把入口误标成不可用 */
const aiReady = ref(true)

/** 这张卡当前是不是"点不进去"的状态 */
function blocked(f: Feature): boolean {
  return !!f.needsAi && !aiReady.value
}

/**
 * 用 custom 模式自己渲染 <a>，不靠"在 RouterLink 上 @click + preventDefault"。
 *
 * 试过那种写法：RouterLink 内部的导航处理先于外部 @click 执行，
 * 等我们 preventDefault 时页面已经跳走了（实测路径变成了 /assessment）。
 * custom + v-slot 把 navigate 交到手上，拦不拦由这里决定，不依赖事件顺序。
 */
function onFeatureClick(
  f: Feature,
  e: MouseEvent,
  navigate: (e?: MouseEvent) => unknown,
) {
  if (blocked(f)) {
    e.preventDefault()
    toast.bad('演示环境未开启')
    return
  }
  navigate(e)
}

onMounted(async () => {
  try {
    const r = await apiGet<{ db: string; dbLatencyMs: number; aiReady?: boolean }>('/health')
    health.value = r.db === 'up' ? 'up' : 'down'
    latency.value = r.dbLatencyMs
    aiReady.value = r.aiReady !== false
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
        custom
        v-slot="{ href, navigate }"
      >
        <a
          :href="href"
          :aria-disabled="blocked(f)"
          class="card flex items-start gap-3 transition"
          :class="
            blocked(f)
              ? 'cursor-not-allowed opacity-50 grayscale'
              : 'hover:-translate-y-0.5 hover:shadow-float'
          "
          @click="onFeatureClick(f, $event, navigate)"
        >
          <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-btn text-xl" :class="f.tone">
            {{ f.icon }}
          </div>
          <div class="min-w-0">
            <h2 class="font-semibold">{{ f.title }}</h2>
            <p class="mt-1 text-sm leading-5 text-ink-weak">{{ f.desc }}</p>
            <p v-if="blocked(f)" class="mt-1 text-xs text-ink-weak">暂未开启</p>
          </div>
        </a>
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
