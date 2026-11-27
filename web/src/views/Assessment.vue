<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import PageHeader from '@/components/PageHeader.vue'
import { assessText } from '@/api/assessment'
import { apiGet } from '@/api/http'
import { useAuthStore } from '@/stores/auth'
import { usePoints } from '@/composables/usePoints'
import { useCheckin } from '@/composables/useCheckin'
import { toast } from '@/composables/useToast'
import {
  ASSESS_DIMENSIONS,
  ASSESS_MIN_CHARS,
  type AssessLevel,
  type AssessResult,
  type AssessSource,
} from '@shared/index'

/**
 * 语言测评。
 *
 * 这一页是给孩子用的，不是给家长看的（家长看 /report）。所以：
 * - 评语说"再练练"而不是"待提升"，四维名称后面挂一句白话解释；
 * - 不显示分数、不排名、没有历史列表——写得不好不该留下"成绩单"；
 * - 结果只存在自己浏览器的 localStorage，服务器不保存原文。
 *
 * 一个刻意的取舍：失败时不渲染空卡片，只留一行灰字。
 * 空卡片看起来像"分析出了个寂寞"，灰字是"这次没成，可以再试"。
 */

const MAX_CHARS = 300
const STORE_KEY = 'assessment:last'

const EXAMPLE =
  '上个星期六，我和妈妈一起去公园放风筝。因为那天风很大，所以风筝一下子就飞起来了。后来线有点缠住，我慢慢把它解开了。最后风筝飞得比树还高，我心里特别高兴。'

const HINTS: Record<string, string> = Object.fromEntries(
  ASSESS_DIMENSIONS.map((d) => [d.key, d.hint]),
)

const auth = useAuthStore()
const points = usePoints()
const checkin = useCheckin()

const text = ref('')
const state = ref<'idle' | 'loading' | 'success' | 'unavailable'>('idle')
const result = ref<AssessResult | null>(null)
const source = ref<AssessSource>('unavailable')
const fromCache = ref(false)
const storedAt = ref('')
const aiReady = ref(true)

/** 按码点数，和有效字数用同一套算法（校验也走 trim 后的码点） */
const len = computed(() => [...text.value.trim()].length)

const canSubmit = computed(
  () => aiReady.value && state.value !== 'loading' && len.value >= ASSESS_MIN_CHARS && len.value <= MAX_CHARS,
)

const hint = computed(() => {
  if (!aiReady.value) return ''
  if (len.value === 0) return `写 ${ASSESS_MIN_CHARS}–${MAX_CHARS} 字，会从用词、通顺、丰富、连贯四个方面看`
  if (len.value < ASSESS_MIN_CHARS) return `再写 ${ASSESS_MIN_CHARS - len.value} 个字就可以提交了`
  if (len.value > MAX_CHARS) return `超了 ${len.value - MAX_CHARS} 个字，精简一下`
  return ''
})

const storedLabel = computed(() => {
  if (!storedAt.value) return ''
  const d = new Date(storedAt.value)
  if (Number.isNaN(d.getTime())) return ''
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`
})

function levelTone(level: AssessLevel): string {
  if (level === '很棒') return 'bg-ok/10 text-ok'
  if (level === '不错') return 'bg-primary-soft text-primary-deep'
  return 'bg-accent/10 text-accent'
}

function fillExample() {
  text.value = EXAMPLE
  if (state.value === 'unavailable') state.value = 'idle'
}

function save(r: AssessResult, from: AssessSource) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ result: r, source: from, at: new Date().toISOString() }))
  } catch {
    /* 无痕模式写不进去，不影响本次查看 */
  }
}

function loadLast() {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as { result?: AssessResult; source?: AssessSource; at?: string }
    // 结构不对就当作没有：早版本的残留数据不能把页面搞崩
    if (!parsed?.result?.dimensions || parsed.result.dimensions.length !== ASSESS_DIMENSIONS.length) return
    result.value = parsed.result
    source.value = parsed.source === 'mock' ? 'mock' : 'model'
    storedAt.value = parsed.at ?? ''
    fromCache.value = true
    state.value = 'success'
  } catch {
    /* 忽略 */
  }
}

async function submit() {
  if (!canSubmit.value) return

  // 未登录不跳转：弹登录层，登录后接着提交，输入框里的字一个不丢
  const ok = await auth.requireLogin()
  if (!ok) return

  state.value = 'loading'
  fromCache.value = false
  result.value = null

  try {
    const r = await assessText(text.value.trim())
    if (r.source === 'unavailable' || !r.result) {
      state.value = 'unavailable'
      return
    }
    result.value = r.result
    source.value = r.source
    state.value = 'success'
    save(r.result, r.source)

    // duplicate 时 apply 静默，不会重复飘分
    if (r.points) points.apply(r.points)
    // 测评也是一次学习动作：不在这里打点，当天的打卡分要等下次进站才补得上
    await checkin.run()
  } catch (e) {
    const err = e as Error & { code?: number }
    if (err.code === 42900) {
      toast.info(err.message || '今天测评次数已用完，明天再来')
    } else {
      toast.bad('网络开小差了，请再试一次')
    }
    state.value = 'idle'
  }
}

onMounted(async () => {
  loadLast()
  try {
    const h = await apiGet<{ aiReady?: boolean }>('/health')
    aiReady.value = h?.aiReady !== false
  } catch {
    /* 健康检查失败不影响提交，真失败时接口会返回 unavailable */
  }
})
</script>

<template>
  <div class="pb-20">
    <PageHeader title="语言测评" subtitle="写一段话，看看哪里棒、哪里还能更好" />

    <section class="card">
      <textarea
        v-model="text"
        rows="6"
        class="input resize-none py-2.5 leading-7"
        :disabled="state === 'loading' || !aiReady"
        :placeholder="aiReady ? '写一件今天发生的事，或者描述你喜欢的一个东西…' : '这个功能暂时没有开启'"
        aria-label="要测评的文字"
      />

      <div class="mt-2 flex items-center justify-between gap-2 text-xs">
        <span
          :class="
            len > MAX_CHARS ? 'text-bad' : len >= ASSESS_MIN_CHARS ? 'text-ok' : 'text-ink-weak'
          "
        >
          {{ len }} / {{ MAX_CHARS }}
        </span>
        <button
          type="button"
          class="min-h-9 px-1 text-primary disabled:opacity-40"
          :disabled="state === 'loading' || !aiReady"
          @click="fillExample"
        >
          用示例试试
        </button>
      </div>

      <p v-if="hint" class="mt-1 text-xs text-ink-weak">{{ hint }}</p>

      <button type="button" class="btn-primary mt-3 w-full" :disabled="!canSubmit" @click="submit">
        {{ state === 'loading' ? '正在分析…' : '开始分析' }}
      </button>

      <p v-if="!aiReady" class="mt-2 text-center text-xs text-ink-weak">
        演示环境未开启 AI，这一页暂时用不了
      </p>
      <p v-else-if="state === 'unavailable'" class="mt-2 text-center text-xs text-ink-weak">
        这次没分析成功，可以再试一次
      </p>

      <p v-if="aiReady" class="mt-2 text-center text-xs text-ink-weak/80">
        写的内容只用来生成这次分析，本站不保存原文
      </p>
    </section>

    <div v-if="state === 'success' && result" class="mt-4 space-y-3">
      <p v-if="fromCache" class="text-xs text-ink-weak">
        上次的测评结果{{ storedLabel ? ` · ${storedLabel}` : '' }}
      </p>

      <section class="card bg-gradient-to-br from-primary-soft to-surface">
        <div class="flex items-center gap-2">
          <span
            class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
            :class="levelTone(result.overall.level)"
          >
            {{ result.overall.level }}
          </span>
          <span v-if="source === 'mock'" class="text-xs text-ink-weak">演示</span>
        </div>
        <p class="mt-2 text-sm leading-6">{{ result.overall.summary }}</p>
        <ul v-if="result.overall.suggestions.length" class="mt-2 space-y-1">
          <li
            v-for="(s, i) in result.overall.suggestions"
            :key="`s${i}`"
            class="text-sm leading-6 text-ink"
          >
            · {{ s }}
          </li>
        </ul>
      </section>

      <section class="grid gap-3 sm:grid-cols-2">
        <article v-for="d in result.dimensions" :key="d.key" class="card">
          <div class="flex items-baseline justify-between gap-2">
            <h2 class="font-semibold">
              {{ d.name }}
              <span class="ml-1 text-xs font-normal text-ink-weak">{{ HINTS[d.key] }}</span>
            </h2>
            <span
              class="shrink-0 rounded-full px-2 py-0.5 text-xs"
              :class="levelTone(d.level)"
            >
              {{ d.level }}
            </span>
          </div>

          <p class="mt-1.5 text-sm leading-6">{{ d.comment }}</p>

          <!-- 证据是原文里真实抠出来的片段，用底色标一下，孩子知道"说的是哪一句" -->
          <p
            v-if="d.evidence"
            class="mt-2 rounded-btn bg-primary-soft/60 px-2 py-1 text-sm leading-6 text-primary-deep"
          >
            「{{ d.evidence }}」
          </p>

          <p class="mt-2 text-xs leading-5 text-ink-weak">试试：{{ d.advice }}</p>
        </article>
      </section>
    </div>
  </div>
</template>
