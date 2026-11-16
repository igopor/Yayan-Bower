<script setup lang="ts">
import { ref, watch } from 'vue'
import AppModal from '@/components/AppModal.vue'
import { fetchTermDetail } from '@/api/content'
import type { TermDetailView } from '@shared/index'
import { usePoints } from '@/composables/usePoints'
import { announceBadges } from '@/composables/useBadge'
import { useCheckin } from '@/composables/useCheckin'
import { useFavorite } from '@/composables/useFavorite'

const props = defineProps<{ modelValue: boolean; termId: number | null }>()
const emit = defineEmits<{
  'update:modelValue': [boolean]
  /** 收藏态变化后通知列表页同步，避免"详情里收藏了，列表还显示没收藏" */
  'favorite-toggled': [id: number, favorited: boolean]
}>()

const points = usePoints()
const checkin = useCheckin()
const { toggle, busyId } = useFavorite()

const detail = ref<TermDetailView | null>(null)
const loading = ref(false)
const error = ref('')

async function load() {
  if (!props.termId) return
  loading.value = true
  error.value = ''
  detail.value = null
  try {
    const d = await fetchTermDetail(props.termId, 'terms')
    detail.value = d
    // 浏览积分由详情接口顺带发放，这里同步顶栏数字并飘 "+2 分"。
    // 重复打开同一词条时后端返回 duplicate，apply 会静默不提示。
    if (d.points) points.apply(d.points)
    announceBadges(d.newBadges)
    // 看完一个词条就算"今天学过"，顺手把当天的打卡补上（不成立时后端返回 no_activity，静默）
    void checkin.run()
  } catch (e) {
    error.value = (e as Error).message || '加载失败'
  } finally {
    loading.value = false
  }
}

function onToggleFavorite() {
  const d = detail.value
  if (!d) return
  void toggle(d.id, d.favorited, (v) => {
    if (detail.value) detail.value.favorited = v
    emit('favorite-toggled', d.id, v)
  })
}

watch(
  () => [props.modelValue, props.termId] as const,
  ([open]) => {
    if (open) void load()
  },
)
</script>

<template>
  <AppModal
    :model-value="modelValue"
    :title="detail?.name ?? '词条详情'"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-if="loading" class="space-y-3 py-2">
      <div class="h-4 w-1/3 animate-pulse rounded bg-line/70" />
      <div class="h-4 w-full animate-pulse rounded bg-line/70" />
      <div class="h-4 w-4/5 animate-pulse rounded bg-line/70" />
    </div>

    <div v-else-if="error" class="py-6 text-center">
      <p class="text-sm text-bad">{{ error }}</p>
      <button type="button" class="btn-ghost mt-3 px-4 text-sm" @click="load">重试</button>
    </div>

    <template v-else-if="detail">
      <section class="mb-4">
        <h3 class="mb-1 text-sm font-medium text-ink-weak">通俗释义</h3>
        <p class="leading-7">{{ detail.plainMeaning }}</p>
      </section>

      <section class="mb-4 rounded-btn bg-primary-soft/70 p-3">
        <h3 class="mb-1 text-sm font-medium text-primary-deep">什么时候能说，什么时候要换</h3>
        <p class="whitespace-pre-line leading-7">{{ detail.heuristicAnalysis }}</p>
      </section>

      <section v-if="detail.elegant" class="mb-4">
        <h3 class="mb-2 text-sm font-medium text-ink-weak">更文雅的说法</h3>
        <div class="space-y-2">
          <div
            v-for="w in [
              { word: detail.elegant.word1, def: detail.elegant.def1 },
              { word: detail.elegant.word2, def: detail.elegant.def2 },
            ]"
            :key="w.word"
            class="rounded-btn border border-line px-3 py-2"
          >
            <p class="font-medium text-primary-deep">{{ w.word }}</p>
            <p class="mt-0.5 text-sm leading-6 text-ink-weak">{{ w.def }}</p>
          </div>
        </div>
      </section>

      <p class="mb-4 text-xs text-ink-weak/80">
        换个说法不丢人，知道什么时候该换才是本事。
      </p>
    </template>

    <div class="flex gap-2">
      <button
        type="button"
        class="btn-ghost flex-1"
        :disabled="!detail || busyId === detail?.id"
        @click="onToggleFavorite"
      >
        <span :class="detail?.favorited ? 'text-accent' : ''">
          {{ detail?.favorited ? '★ 已收藏' : '☆ 收藏' }}
        </span>
      </button>
      <button type="button" class="btn-primary flex-1" @click="emit('update:modelValue', false)">
        知道了
      </button>
    </div>
  </AppModal>
</template>
