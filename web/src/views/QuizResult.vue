<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageHeader from '@/components/PageHeader.vue'
import AppCard from '@/components/AppCard.vue'
import AppLoading from '@/components/AppLoading.vue'
import { useQuizStore } from '@/stores/quiz'
import { toast } from '@/composables/useToast'
import { announceBadges } from '@/composables/useBadge'
import { useCheckin } from '@/composables/useCheckin'
import { POINT_RULES, QUIZ_PERFECT_RATE, type QuizResultView } from '@shared/index'

/**
 * 结算页。
 *
 * 数据来源两条路：
 * 1. 正常流程 —— 答题页算完通过 store 带过来；
 * 2. 刷新页面 —— store 空了，用地址栏的 `?id=` 再调一次 finish。
 *    这就是结算接口做成幂等的原因：重取不能重复发积分。
 */

const route = useRoute()
const router = useRouter()
const quiz = useQuizStore()
const checkin = useCheckin()

const data = ref<QuizResultView | null>(null)
const loading = ref(true)
const error = ref('')
const againBusy = ref(false)

const perfectHint = Math.round(QUIZ_PERFECT_RATE * 100)
const gotPerfectBonus = computed(
  () => data.value !== null && data.value.accuracy >= perfectHint,
)
const unanswered = computed(() =>
  data.value ? Math.max(0, data.value.total - data.value.answeredCount) : 0,
)

onMounted(async () => {
  if (quiz.result) {
    data.value = quiz.result
    loading.value = false
    announceBadges(quiz.result.newBadges)
    void checkin.run()
    return
  }

  const id = Number(route.query.id)
  if (!Number.isInteger(id) || id <= 0) {
    await router.replace('/quiz')
    return
  }

  try {
    data.value = await quiz.loadResult(id)
    announceBadges(data.value.newBadges)
    void checkin.run()
  } catch (e) {
    error.value = (e as Error).message || '取不到这一轮的成绩'
  } finally {
    loading.value = false
  }
})

async function playAgain() {
  if (againBusy.value) return
  againBusy.value = true
  try {
    await quiz.start()
    await router.push('/quiz/play')
  } catch (e) {
    toast.bad((e as Error).message || '开局失败，请重试')
  } finally {
    againBusy.value = false
  }
}
</script>

<template>
  <!-- 桌面端收窄到一列：结算页只有一组数字，铺满 1200px 会显得空旷 -->
  <div class="md:mx-auto md:max-w-xl">
    <PageHeader title="本轮结果" back-to="/quiz" />

    <AppCard v-if="loading">
      <AppLoading text="正在结算…" />
    </AppCard>

    <AppCard v-else-if="error">
      <div class="py-6 text-center">
        <p class="text-sm text-bad">{{ error }}</p>
        <RouterLink to="/quiz" class="btn-ghost mt-3 px-4 text-sm">回情景挑战</RouterLink>
      </div>
    </AppCard>

    <template v-else-if="data">
      <!-- 主结果：正确率是这页唯一的主角，其余数字都往下放 -->
      <AppCard>
        <div class="flex flex-col items-center py-2">
          <p class="text-5xl font-semibold tabular-nums text-primary-deep">{{ data.accuracy }}%</p>
          <p class="mt-1 text-sm text-ink-weak">
            答对 <strong class="text-ink">{{ data.correctCount }}</strong> / {{ data.total }} 题
          </p>
          <p class="mt-4 px-2 text-center text-base leading-7">{{ data.comment }}</p>
        </div>
      </AppCard>

      <p v-if="unanswered > 0" class="mt-2 text-center text-xs text-ink-weak">
        有 {{ unanswered }} 题没来得及作答，已算作答错
      </p>

      <AppCard title="本轮积分" class="mt-3">
        <div class="flex items-baseline justify-between">
          <span class="text-sm text-ink-weak">获得</span>
          <span class="text-2xl font-semibold text-accent">+{{ data.totalEarned }} 分</span>
        </div>

        <div class="mt-3 space-y-1.5 border-t border-line pt-3 text-sm">
          <div class="flex items-center justify-between">
            <span class="text-ink-weak">完成一轮</span>
            <span class="text-ink">+{{ POINT_RULES.QUIZ_FINISH }}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-ink-weak">正确率 ≥ {{ perfectHint }}% 的额外奖励</span>
            <span :class="gotPerfectBonus ? 'text-accent' : 'text-ink-weak/70'">
              {{ gotPerfectBonus ? `+${POINT_RULES.QUIZ_PERFECT}` : '未达成' }}
            </span>
          </div>
        </div>

        <p class="mt-3 text-xs text-ink-weak/80">
          积分已经记到你的账号里，可以在「我的」看到明细。
        </p>
      </AppCard>

      <div class="mt-4 flex gap-2">
        <button type="button" class="btn-ghost flex-1" @click="router.push('/quiz')">
          回情景挑战
        </button>
        <button type="button" class="btn-primary flex-1" :disabled="againBusy" @click="playAgain">
          {{ againBusy ? '正在出题…' : '再来一次' }}
        </button>
      </div>
    </template>
  </div>
</template>
