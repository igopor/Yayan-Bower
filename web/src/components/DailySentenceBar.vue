<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { fetchDailySentence } from '@/api/content'
import type { DailySentence } from '@shared/index'

/**
 * 底栏【每日一句】。
 *
 * 折叠时只露一句话（孩子扫一眼就走），点开才给出处和意义解读——
 * 出处和解读是"老师会问的东西"，默认铺开反而把正文挤没了。
 *
 * 数据同一天永远同一条（后端按 `天数 % 总数` 取），刷新不会变。
 */
const sentence = ref<DailySentence | null>(null)
const open = ref(false)
const error = ref(false)

onMounted(async () => {
  try {
    sentence.value = await fetchDailySentence()
  } catch {
    // 底栏不是主内容，取不到就整条不显示，不占屏幕也不打扰
    error.value = true
  }
})
</script>

<template>
  <div
    v-if="sentence && !error"
    class="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur"
    :style="{ paddingBottom: 'env(safe-area-inset-bottom)' }"
  >
    <div class="mx-auto w-full max-w-page px-4 md:px-6">
      <button
        type="button"
        class="flex w-full items-center gap-3 py-3 text-left"
        :aria-expanded="open"
        @click="open = !open"
      >
        <span class="shrink-0 text-xs font-medium text-accent">每日一句</span>
        <span class="min-w-0 flex-1 truncate text-sm">{{ sentence.content }}</span>
        <span
          class="shrink-0 text-xs text-ink-weak transition-transform"
          :class="open ? 'rotate-180' : ''"
          aria-hidden="true"
        >
          ▲
        </span>
      </button>

      <Transition name="fade">
        <div v-if="open" class="max-h-[46vh] overflow-y-auto pb-3">
          <p class="text-base leading-7">{{ sentence.content }}</p>
          <p class="mt-2 text-sm text-ink-weak">—— {{ sentence.source }}</p>
          <p class="mt-2 rounded-btn bg-primary-soft/60 p-3 text-sm leading-6">
            {{ sentence.meaning }}
          </p>
        </div>
      </Transition>
    </div>
  </div>
</template>
