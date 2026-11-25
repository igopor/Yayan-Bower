<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import PageHeader from '@/components/PageHeader.vue'
import AppCard from '@/components/AppCard.vue'
import AppLoading from '@/components/AppLoading.vue'
import EmptyState from '@/components/EmptyState.vue'
import { useAuthStore } from '@/stores/auth'
import { fetchAiSummary, fetchReportSummary } from '@/api/mine'
import { exportElementAsPng, reportFileName } from '@/lib/export-image'
import { toast } from '@/composables/useToast'
import type { AiSummaryView, ReportSummaryView } from '@shared/index'

/**
 * 家校反馈。
 *
 * 这一页的产物是**一张图**，不是一堆数据。所以版式按"手机上能看清"来排：
 * 数字大、段落短、不用表格。孩子不会看这一页，家长会把它转给另一个家长。
 *
 * 三段文案（优势 / 待加强 / 建议）由服务端生成，前端只渲染 —— 规则集中在
 * `shared/report-text.ts`，那样才能单测"任意数据组合都不出硬伤"。
 *
 * AI 小结是**后到的**：先画数字，再单独请求 AI（见 loadAi）。它失败时整块不显示，
 * 页面照旧完整——这块是增强，不是依赖。
 */

const auth = useAuthStore()

const data = ref<ReportSummaryView | null>(null)
const loading = ref(false)
const error = ref('')
const exporting = ref(false)
const reportRef = ref<HTMLElement | null>(null)

const ai = ref<AiSummaryView | null>(null)
const aiLoading = ref(false)

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
    ai.value = null
    return
  }
  loading.value = true
  error.value = ''
  try {
    data.value = await fetchReportSummary()
    // 数字已经能看了，AI 让它在后台慢慢来
    void loadAi()
  } catch (e) {
    error.value = (e as Error).message || '生成失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

/**
 * 取 AI 小结。
 *
 * 三种结局都当"正常"处理，不弹错误：
 * - 有内容（model / mock）→ 显示卡片；
 * - `unavailable`（未开启或模型调用失败）→ 不显示卡片，页面照旧；
 * - 请求本身失败（断网）→ 同上，只在控制台留一条。
 * 只有用户主动点「重新生成」却没拿到内容时，才给他一句提示——
 * 那时候他是在等一个回应，静默会让人以为按钮坏了。
 */
async function loadAi(force = false) {
  aiLoading.value = true
  try {
    const r = await fetchAiSummary(force)
    ai.value = r.source === 'unavailable' ? null : r
    if (force && r.source === 'unavailable') {
      toast.bad('AI 小结暂时不可用，稍后再试')
    }
  } catch (e) {
    console.warn('[report] AI 小结获取失败', e)
    if (force) toast.bad('AI 小结暂时不可用，稍后再试')
  } finally {
    aiLoading.value = false
  }
}

async function saveImage() {
  if (!reportRef.value || !stats.value || exporting.value || aiLoading.value) return
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

          <!--
            AI 小结。在导出区内，所以会出现在图里 —— 家长转出去的那张图上，
            这一段往往是最先被读的。
            `ai` 为空（AI 未启用 / 调用失败）时整块不渲染，页面和没有这个功能时完全一样。
          -->
          <div
            v-if="aiLoading || ai"
            class="mt-4 rounded-btn border border-primary/30 bg-primary-soft/40 p-3"
          >
            <div class="flex items-baseline justify-between gap-2">
              <h3 class="text-sm font-semibold text-primary-deep">AI 小结</h3>
              <span
                v-if="ai"
                class="shrink-0 rounded-full bg-white/70 px-2 py-0.5 text-[10px] text-ink-weak"
              >
                {{ ai.source === 'mock' ? '演示' : 'AI 生成' }}
              </span>
            </div>

            <template v-if="ai">
              <p class="mt-1.5 text-sm leading-6 text-ink">{{ ai.summary }}</p>
              <ul v-if="ai.suggestions.length" class="mt-1.5 space-y-1">
                <li v-for="(s, i) in ai.suggestions" :key="`ai${i}`" class="text-sm leading-6 text-ink">
                  · {{ s }}
                </li>
              </ul>
            </template>

            <div v-else class="mt-2 space-y-1.5" aria-hidden="true">
              <div class="h-3 w-full animate-pulse rounded bg-white/70"></div>
              <div class="h-3 w-5/6 animate-pulse rounded bg-white/70"></div>
              <div class="h-3 w-2/3 animate-pulse rounded bg-white/70"></div>
            </div>

            <p class="mt-2 text-[10px] text-ink-weak/80">本段由 AI 根据本页数据生成，仅供参考</p>
          </div>

          <footer class="mt-4 flex items-center justify-between border-t border-line pt-3 text-xs text-ink-weak">
            <span>连续 {{ stats.streak }} 天 · 累计 {{ stats.totalPoints }} 分 · {{ stats.badgeCount }} 枚徽章</span>
            <span class="shrink-0">雅言小筑</span>
          </footer>
        </section>

        <button
          type="button"
          class="btn-primary mt-4 w-full"
          :disabled="exporting || aiLoading"
          @click="saveImage"
        >
          {{ exporting ? '正在生成图片…' : aiLoading ? 'AI 小结生成中…' : '保存为图片' }}
        </button>
        <p class="mt-2 text-center text-xs text-ink-weak/80">
          <template v-if="aiLoading">等 AI 小结写完再导出，否则图里会缺这一段。</template>
          <template v-else>手机上会弹出分享面板，选「存储图像」即可存到相册；电脑上会直接下载。</template>
        </p>

        <!-- 卡片之外的重生成入口：放在导出区外，导出的图上不会出现一个按钮 -->
        <button
          v-if="ai"
          type="button"
          class="mt-1 flex min-h-9 w-full items-center justify-center text-xs text-ink-weak disabled:opacity-50"
          :disabled="aiLoading"
          @click="loadAi(true)"
        >
          重新生成 AI 小结
        </button>

        <RouterLink to="/mine" class="mt-2 flex min-h-9 items-center justify-center text-xs text-primary">
          去「我的」看徽章和收藏 →
        </RouterLink>
      </template>
    </template>
  </div>
</template>
