<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import PageHeader from '@/components/PageHeader.vue'
import AppCard from '@/components/AppCard.vue'
import AppLoading from '@/components/AppLoading.vue'
import EmptyState from '@/components/EmptyState.vue'
import { useAuthStore } from '@/stores/auth'
import { fetchReportSummary } from '@/api/mine'
import { exportElementAsPng, reportFileName } from '@/lib/export-image'
import { toast } from '@/composables/useToast'
import type { ReportSummaryView } from '@shared/index'

/**
 * 家校反馈。
 *
 * 这一页的产物是**一张图**，不是一堆数据。所以版式按"手机上能看清"来排：
 * 数字大、段落短、不用表格。孩子不会看这一页，家长会把它转给另一个家长。
 *
 * 三段文案（优势 / 待加强 / 建议）由服务端生成，前端只渲染 —— 规则集中在
 * `shared/report-text.ts`，那样才能单测"任意数据组合都不出硬伤"。
 */

const auth = useAuthStore()

const data = ref<ReportSummaryView | null>(null)
const loading = ref(false)
const error = ref('')
const exporting = ref(false)
const reportRef = ref<HTMLElement | null>(null)

const stats = computed(() => data.value?.stats ?? null)
const text = computed(() => data.value?.text ?? null)
/** 没闯过关时不显示 0%，显示"—"：0% 会被家长误读成"一题都不会" */
const accuracyLabel = computed(() =>
  stats.value && stats.value.quizRounds > 0 ? `${stats.value.quizAvgAccuracy}%` : '—',
)
const dateLabel = computed(() => {
  const iso = stats.value?.generatedAt
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`
})

async function load() {
  if (!auth.isLoggedIn) {
    data.value = null
    return
  }
  loading.value = true
  error.value = ''
  try {
    data.value = await fetchReportSummary()
  } catch (e) {
    error.value = (e as Error).message || '生成失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

async function saveImage() {
  if (!reportRef.value || !stats.value || exporting.value) return
  exporting.value = true
  try {
    const r = await exportElementAsPng(reportRef.value, reportFileName(stats.value.nickname))
    toast.ok(r === 'shared' ? '已打开分享面板，可存到相册' : '图片已保存')
  } catch (e) {
    console.error('[report] 导出失败', e)
    toast.bad('生成图片失败，换个浏览器或稍后再试')
  } finally {
    exporting.value = false
  }
}

onMounted(load)
watch(() => auth.isLoggedIn, () => void load())
</script>

<template>
  <div class="md:mx-auto md:max-w-2xl">
    <PageHeader title="家校反馈" subtitle="把这段时间的学习情况生成一张图" />

    <AppCard v-if="!auth.isLoggedIn">
      <EmptyState text="登录后才有学习数据" hint="这张报告只汇总你自己账号里的记录" icon="📊">
        <button type="button" class="btn-primary mt-2 px-6" @click="auth.requireLogin()">
          手机号登录
        </button>
      </EmptyState>
    </AppCard>

    <template v-else>
      <AppCard v-if="loading && !data">
        <AppLoading text="正在汇总…" />
      </AppCard>

      <AppCard v-else-if="error">
        <div class="py-6 text-center">
          <p class="text-sm text-bad">{{ error }}</p>
          <button type="button" class="btn-ghost mt-3 px-4 text-sm" @click="load">重试</button>
        </div>
      </AppCard>

      <template v-else-if="data && stats && text">
        <!--
          被导出的那块。刻意写成纯白卡片 + 内联不依赖外部资源的样式：
          html-to-image 会把这段 DOM 序列化成 SVG 再栅格化，
          任何外部图片/CSS 变量都会增加导出失败的概率。
        -->
        <section ref="reportRef" class="rounded-card bg-white p-5 shadow-card">
          <header class="border-b border-line pb-3">
            <div class="flex items-baseline justify-between gap-2">
              <h2 class="text-lg font-semibold text-ink">雅言小筑 · 学习小结</h2>
              <span class="shrink-0 text-xs text-ink-weak">{{ dateLabel }}</span>
            </div>
            <p class="mt-1 text-sm text-ink-weak">{{ stats.nickname }} 的学习记录</p>
          </header>

          <div class="mt-4 grid grid-cols-4 gap-2 text-center">
            <div>
              <p class="text-xl font-semibold tabular-nums text-primary-deep">{{ stats.termCount }}</p>
              <p class="mt-0.5 text-[11px] text-ink-weak">看过热梗</p>
            </div>
            <div>
              <p class="text-xl font-semibold tabular-nums text-primary-deep">{{ stats.elegantCount }}</p>
              <p class="mt-0.5 text-[11px] text-ink-weak">学过的雅词</p>
            </div>
            <div>
              <p class="text-xl font-semibold tabular-nums text-primary-deep">{{ stats.quizRounds }}</p>
              <p class="mt-0.5 text-[11px] text-ink-weak">闯关轮次</p>
            </div>
            <div>
              <p class="text-xl font-semibold tabular-nums text-primary-deep">{{ accuracyLabel }}</p>
              <p class="mt-0.5 text-[11px] text-ink-weak">平均正确率</p>
            </div>
          </div>

          <p
            v-if="stats.quizRounds === 0"
            class="mt-2 text-center text-[11px] text-ink-weak/80"
          >
            还没闯过关，正确率暂不统计
          </p>

          <div class="mt-4 space-y-3">
            <div>
              <h3 class="text-sm font-semibold text-ok">做得好的地方</h3>
              <ul class="mt-1 space-y-1">
                <li v-for="(line, i) in text.strengths" :key="`s${i}`" class="text-sm leading-6 text-ink">
                  · {{ line }}
                </li>
              </ul>
            </div>

            <div>
              <h3 class="text-sm font-semibold text-accent">可以再练一练</h3>
              <ul class="mt-1 space-y-1">
                <li v-for="(line, i) in text.improvements" :key="`i${i}`" class="text-sm leading-6 text-ink">
                  · {{ line }}
                </li>
              </ul>
            </div>

            <div class="rounded-btn bg-primary-soft/70 p-3">
              <h3 class="text-sm font-semibold text-primary-deep">给家长的建议</h3>
              <ul class="mt-1 space-y-1">
                <li v-for="(line, i) in text.advice" :key="`a${i}`" class="text-sm leading-6 text-ink">
                  · {{ line }}
                </li>
              </ul>
            </div>
          </div>

          <footer class="mt-4 flex items-center justify-between border-t border-line pt-3 text-xs text-ink-weak">
            <span>连续 {{ stats.streak }} 天 · 累计 {{ stats.totalPoints }} 分 · {{ stats.badgeCount }} 枚徽章</span>
            <span class="shrink-0">雅言小筑</span>
          </footer>
        </section>

        <button
          type="button"
          class="btn-primary mt-4 w-full"
          :disabled="exporting"
          @click="saveImage"
        >
          {{ exporting ? '正在生成图片…' : '保存为图片' }}
        </button>
        <p class="mt-2 text-center text-xs text-ink-weak/80">
          手机上会弹出分享面板，选「存储图像」即可存到相册；电脑上会直接下载。
        </p>

        <RouterLink to="/mine" class="mt-2 flex min-h-9 items-center justify-center text-xs text-primary">
          去「我的」看徽章和收藏 →
        </RouterLink>
      </template>
    </template>
  </div>
</template>
