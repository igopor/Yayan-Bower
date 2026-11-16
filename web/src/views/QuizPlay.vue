<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import AppModal from '@/components/AppModal.vue'
import { useQuizStore } from '@/stores/quiz'
import { usePoints } from '@/composables/usePoints'
import { toast } from '@/composables/useToast'
import type { QuizPick } from '@shared/index'

/**
 * 答题页。整页只有两种状态：**答题中 / 看反馈**。
 *
 * 倒计时的实现要点：不自己"每秒减一"，而是每次都用
 * `now - 本题起点` 重算剩余时间。手机切后台时浏览器会把定时器压到最慢，
 * 减一法会停在"还剩 12 秒"，回来还能慢慢想；重算法回来直接就是 0。
 * 前端倒计时只负责显示，真正判超时的是服务端时间戳。
 */

const router = useRouter()
const quiz = useQuizStore()
const points = usePoints()

const now = ref(Date.now())
let ticker: number | undefined

const exitOpen = ref(false)
const finishing = ref(false)
const nextBusy = ref(false)
/** 超时自动交卷的重试次数。网络抖一下不该直接把人卡死在 0 秒 */
let timeoutRetry = 2
/** 允许离开：结算完、或用户确认放弃后，路由守卫不再拦 */
let allowLeave = false
let pendingTo = '/quiz'

const remainMs = computed(() =>
  quiz.current ? Math.max(0, quiz.questionStartedAt + quiz.seconds * 1000 - now.value) : 0,
)
const remainSec = computed(() => Math.ceil(remainMs.value / 1000))
const urgent = computed(() => remainSec.value <= 5)
const options = computed(() => quiz.current?.options ?? [])
const progressPct = computed(() => (quiz.total ? (quiz.seq / quiz.total) * 100 : 0))
const expired = computed(
  () =>
    quiz.current !== null &&
    quiz.feedback === null &&
    quiz.questionStartedAt > 0 &&
    remainMs.value <= 0,
)

function startTicker() {
  stopTicker()
  now.value = Date.now()
  ticker = window.setInterval(() => {
    now.value = Date.now()
  }, 100)
}

function stopTicker() {
  if (ticker !== undefined) {
    window.clearInterval(ticker)
    ticker = undefined
  }
}

/** 切回前台立刻按真实时间重算，不等下一次定时器 */
function onVisible() {
  if (!document.hidden && quiz.feedback === null) now.value = Date.now()
}

onMounted(() => {
  // 刷新页面 = 这一轮丢了（断线恢复本期不做），直接回入口重新开始
  if (!quiz.session || !quiz.current) {
    toast.info('这一轮已经断开了，请重新开始')
    allowLeave = true
    void router.replace('/quiz')
    return
  }
  startTicker()
  document.addEventListener('visibilitychange', onVisible)
})

onBeforeUnmount(() => {
  stopTicker()
  document.removeEventListener('visibilitychange', onVisible)
})

// 反馈弹出来就停表：读解析的时间不该算进下一题
watch(
  () => quiz.feedback,
  (f) => {
    if (f) stopTicker()
  },
)

// 进入下一题：起点变了，重新起表
watch(
  () => quiz.questionStartedAt,
  () => {
    if (quiz.feedback === null) startTicker()
  },
)

async function submit(pick: QuizPick | null) {
  if (quiz.feedback || quiz.submitting) return
  try {
    await quiz.submit(pick)
  } catch (e) {
    // 超时自动交卷失败：倒计时已经是 0，watch 不会二次触发，必须自己重试
    if (pick === null && timeoutRetry > 0) {
      timeoutRetry--
      window.setTimeout(() => void submit(null), 1200)
      return
    }
    toast.bad((e as Error).message || '提交失败，请检查网络')
  }
}

watch(expired, (v) => {
  if (v) void submit(null)
})

const fbIcon = computed(() => {
  const f = quiz.feedback
  if (!f) return ''
  if (f.isCorrect) return '✅'
  return f.timedOut ? '⏰' : '❌'
})

const fbTitle = computed(() => {
  const f = quiz.feedback
  if (!f) return ''
  if (f.isCorrect) return '太棒啦！回答正确！'
  if (f.timedOut) return '下一次再加油！'
  return '没关系，我们一起来想一想！'
})

const fbHint = computed(() => {
  const f = quiz.feedback
  if (!f) return ''
  if (f.isCorrect) return '判断得很准。'
  return f.timedOut ? '时间到了，这题算没答对。' : '差一点点，看看正确答案是怎么说的。'
})

async function onNext() {
  if (!quiz.feedback || nextBusy.value || finishing.value) return

  if (quiz.feedback.nextSeq === null) {
    await goResult()
    return
  }

  nextBusy.value = true
  try {
    await quiz.next()
  } catch (e) {
    toast.bad((e as Error).message || '进入下一题失败，请重试')
  } finally {
    nextBusy.value = false
  }
}

/** 结算并发积分。finish 是幂等的，重复调用不会重复给分 */
async function goResult() {
  if (finishing.value) return
  finishing.value = true
  try {
    const r = await quiz.finish()
    if (!r) return
    if (r.finishPoints) points.apply(r.finishPoints)
    if (r.perfectPoints) points.apply(r.perfectPoints)
    allowLeave = true
    await router.replace({ path: '/quiz/result', query: { id: String(r.sessionId) } })
  } catch (e) {
    toast.bad((e as Error).message || '结算失败，请重试')
  } finally {
    finishing.value = false
  }
}

function askExit() {
  pendingTo = '/quiz'
  exitOpen.value = true
}

/**
 * 中途离开要二次确认。
 * 这里用路由守卫而不是只拦返回按钮：右上导航的「首页」也能走，
 * 只拦自己的返回按钮等于没拦。
 */
onBeforeRouteLeave((to) => {
  if (allowLeave || !quiz.session) return true
  pendingTo = to.fullPath
  exitOpen.value = true
  return false
})

async function confirmExit() {
  exitOpen.value = false
  quiz.reset()
  allowLeave = true
  await router.push(pendingTo)
}
</script>

<template>
  <div class="pb-6 md:mx-auto md:max-w-2xl">
    <!-- 顶部：退出 / 进度 / 倒计时。不用 PageHeader：它的返回按钮是直接 router.push，绕不过确认 -->
    <div class="mb-4 flex items-center gap-3">
      <button
        type="button"
        aria-label="退出挑战"
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink-weak hover:text-ink"
        @click="askExit"
      >
        ✕
      </button>

      <div class="min-w-0 flex-1">
        <div class="flex items-baseline justify-between">
          <span class="text-sm text-ink-weak">
            第 <strong class="text-ink">{{ quiz.seq }}</strong> / {{ quiz.total }} 题
          </span>
          <span
            class="font-semibold tabular-nums"
            :class="urgent ? 'text-bad' : 'text-primary-deep'"
          >
            {{ remainSec }} 秒
          </span>
        </div>
        <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line/70">
          <div
            class="h-full rounded-full transition-all duration-200"
            :class="urgent ? 'bg-bad' : 'bg-primary'"
            :style="{ width: `${progressPct}%` }"
          />
        </div>
      </div>
    </div>

    <div v-if="quiz.current" class="card">
      <p class="text-[17px] leading-8">{{ quiz.current.stem }}</p>
    </div>

    <div class="mt-3 space-y-2">
      <button
        v-for="(opt, i) in options"
        :key="i"
        type="button"
        class="flex min-h-[60px] w-full items-center gap-3 rounded-btn border bg-surface px-4 py-3 text-left transition"
        :class="
          quiz.submitting
            ? 'border-line opacity-60'
            : 'border-line hover:border-primary hover:bg-primary-soft/40 active:scale-[0.99]'
        "
        :disabled="quiz.submitting"
        @click="submit(i === 0 ? 'A' : 'B')"
      >
        <span
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary-deep"
        >
          {{ i === 0 ? 'A' : 'B' }}
        </span>
        <span class="text-base leading-6">{{ opt }}</span>
      </button>
    </div>

    <p class="mt-3 text-center text-xs text-ink-weak">点一下就算交卷，不能改也不能回退</p>

    <!-- 即时反馈。不可关闭：必须点「下一题」才继续，避免连点跳过看结果 -->
    <AppModal :model-value="quiz.feedback !== null" :closable="false">
      <div class="text-center">
        <div class="text-4xl">{{ fbIcon }}</div>
        <p
          class="mt-2 text-lg font-semibold"
          :class="quiz.feedback?.isCorrect ? 'text-ok' : 'text-ink'"
        >
          {{ fbTitle }}
        </p>
        <p class="mt-1 text-sm text-ink-weak">{{ fbHint }}</p>
      </div>

      <div v-if="quiz.feedback" class="mt-4 rounded-btn bg-primary-soft/60 p-3">
        <p class="text-sm">
          <span class="text-ink-weak">正确答案：</span>
          <span class="font-medium text-primary-deep">{{ quiz.feedback.correctText }}</span>
        </p>
        <p v-if="quiz.feedback.explanation" class="mt-2 text-sm leading-6 text-ink">
          {{ quiz.feedback.explanation }}
        </p>
      </div>

      <button
        type="button"
        class="btn-primary mt-4 w-full"
        :disabled="nextBusy || finishing"
        @click="onNext"
      >
        <template v-if="quiz.feedback?.nextSeq === null">
          {{ finishing ? '正在结算…' : '看结果' }}
        </template>
        <template v-else>下一题</template>
      </button>
    </AppModal>

    <!-- 退出确认 -->
    <AppModal v-model="exitOpen" title="要退出这一轮吗？">
      <p class="text-sm leading-6 text-ink-weak">
        已经答的题不会保存，也不会拿到积分。下次要从第一题重新开始。
      </p>
      <div class="mt-5 flex gap-2">
        <button type="button" class="btn-primary flex-1" @click="exitOpen = false">继续答题</button>
        <button type="button" class="btn-ghost flex-1" @click="confirmExit">退出</button>
      </div>
    </AppModal>
  </div>
</template>
