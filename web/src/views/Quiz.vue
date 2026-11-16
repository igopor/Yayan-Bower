<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import PageHeader from '@/components/PageHeader.vue'
import AppCard from '@/components/AppCard.vue'
import AppModal from '@/components/AppModal.vue'
import { useAuthStore } from '@/stores/auth'
import { useQuizStore } from '@/stores/quiz'
import { POINT_RULES, QUIZ_SIZE, QUIZ_SECONDS, QUIZ_PERFECT_RATE } from '@shared/index'

const router = useRouter()
const auth = useAuthStore()
const quiz = useQuizStore()

const confirmOpen = ref(false)
const busy = ref(false)
const error = ref('')

const perfectHint = Math.round(QUIZ_PERFECT_RATE * 100)

function openConfirm() {
  error.value = ''
  confirmOpen.value = true
}

/**
 * 开始一轮。
 *
 * 登录放在这一步而不是进页面就要求：先让没登录的人也能看到规则、知道自己要玩什么，
 * 点了「开始」才要求登录 —— 这跟全站"先看到价值再要求注册"一致。
 * `await auth.requireLogin()` 挂在这里等，登录成功后接着往下走，不跳转不刷新。
 */
async function begin() {
  busy.value = true
  error.value = ''
  try {
    if (!(await auth.requireLogin())) {
      error.value = '登录后才能开始挑战，成绩和积分要记在你名下'
      return
    }
    await quiz.start()
    confirmOpen.value = false
    await router.push('/quiz/play')
  } catch (e) {
    error.value = (e as Error).message || '开局失败，请重试'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <!-- 单列阅读型页面，桌面端也收窄：1200px 宽的一行字读起来很累 -->
  <div class="md:mx-auto md:max-w-2xl">
    <PageHeader title="情景挑战" :subtitle="`${QUIZ_SIZE} 道场景题，每题 ${QUIZ_SECONDS} 秒`" />

    <AppCard title="怎么玩">
      <ol class="space-y-2 text-sm leading-6">
        <li class="flex gap-2">
          <span class="text-primary-deep">1</span>
          <span>题目都是真实会遇到的场面——课堂上、同学之间、给长辈说话。</span>
        </li>
        <li class="flex gap-2">
          <span class="text-primary-deep">2</span>
          <span>每题只有两个选项，点一个就算交卷，<strong>不能改、不能回退</strong>。</span>
        </li>
        <li class="flex gap-2">
          <span class="text-primary-deep">3</span>
          <span>每题 {{ QUIZ_SECONDS }} 秒，时间到了自动算没答对。</span>
        </li>
      </ol>
    </AppCard>

    <AppCard title="能得多少分" class="mt-3">
      <div class="space-y-2 text-sm">
        <div class="flex items-center justify-between">
          <span class="text-ink-weak">完成一轮</span>
          <span class="font-medium text-accent">+{{ POINT_RULES.QUIZ_FINISH }} 分</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-ink-weak">正确率达到 {{ perfectHint }}%</span>
          <span class="font-medium text-accent">再 +{{ POINT_RULES.QUIZ_PERFECT }} 分</span>
        </div>
        <p class="pt-1 text-xs text-ink-weak/80">
          每轮只发一次。答案由服务端判，改电脑时间不算数。
        </p>
      </div>
    </AppCard>

    <button type="button" class="btn-primary mt-4 w-full" @click="openConfirm">开始挑战</button>

    <p v-if="!auth.isLoggedIn" class="mt-2 text-center text-xs text-ink-weak">
      未登录也能试玩，但成绩和积分不会保存
    </p>

    <!-- 规则确认。故意做成每次都要点一次：中途退出会丢进度，先说清楚 -->
    <AppModal v-model="confirmOpen" title="准备好了吗？">
      <div class="space-y-3 text-sm leading-6">
        <p>
          本轮共 <strong class="text-primary-deep">{{ QUIZ_SIZE }}</strong> 题，每题
          <strong class="text-primary-deep">{{ QUIZ_SECONDS }}</strong> 秒。
        </p>
        <p class="text-ink-weak">
          选中就提交，不能回头改。中途退出这一轮的成绩不会保存。
        </p>
        <p v-if="error" class="text-bad">{{ error }}</p>
      </div>

      <div class="mt-5 flex gap-2">
        <button type="button" class="btn-ghost flex-1" :disabled="busy" @click="confirmOpen = false">
          再想想
        </button>
        <button type="button" class="btn-primary flex-1" :disabled="busy" @click="begin">
          {{ busy ? '正在出题…' : '开始' }}
        </button>
      </div>
    </AppModal>
  </div>
</template>
