<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageHeader from '@/components/PageHeader.vue'
import AppCard from '@/components/AppCard.vue'
import EmptyState from '@/components/EmptyState.vue'
import DailySentenceBar from '@/components/DailySentenceBar.vue'
import { fetchElegantDetail, fetchElegantList } from '@/api/content'
import type { ElegantDetailView, ElegantListItem } from '@shared/index'
import { useAuthStore } from '@/stores/auth'
import { useFavorite } from '@/composables/useFavorite'
import { usePoints } from '@/composables/usePoints'
import { announceBadges } from '@/composables/useBadge'
import { useCheckin } from '@/composables/useCheckin'
import { toast } from '@/composables/useToast'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const points = usePoints()
const checkin = useCheckin()
const { toggle, busyId } = useFavorite()

/** 从辨析页空状态跳过来时会带 `?q=绝绝子`，这里直接预填，不用用户再打一遍 */
const keyword = ref(typeof route.query.q === 'string' ? route.query.q : '')

const list = ref<ElegantListItem[]>([])
const page = ref(1)
const total = ref(0)
const hasMore = ref(false)
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')

/**
 * 展开态与已取到的对照内容。
 * 展开才请求 `/elegant/:id`（浏览积分挂在那个接口上），所以这里要缓存，
 * 收起再展开不该重新请求、也不该重复加分。
 */
const expandedId = ref<number | null>(null)
const details = ref<Record<number, ElegantDetailView>>({})
const loadingDetail = ref<number | null>(null)

const searching = computed(() => keyword.value.trim().length > 0)

async function loadList(reset: boolean) {
  if (reset) {
    loading.value = true
    error.value = ''
  } else {
    loadingMore.value = true
  }
  try {
    const target = reset ? 1 : page.value + 1
    const r = await fetchElegantList({ keyword: keyword.value.trim(), page: target })
    list.value = reset ? r.items : [...list.value, ...r.items]
    page.value = r.page
    total.value = r.total
    hasMore.value = r.hasMore
    if (reset) expandedId.value = null
  } catch (e) {
    error.value = (e as Error).message || '加载失败'
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

/** 防抖 300ms：中文输入法下一个词会触发多次 input，逐次请求还会乱序 */
let debounceTimer: number | undefined
watch(keyword, () => {
  window.clearTimeout(debounceTimer)
  debounceTimer = window.setTimeout(() => {
    const q = keyword.value.trim()
    if ((route.query.q ?? '') !== q) void router.replace({ query: q ? { q } : {} })
    void loadList(true)
  }, 300)
})
onBeforeUnmount(() => window.clearTimeout(debounceTimer))

// 登录成功后重拉：收藏态跟着用户走，不刷新会显示成"一个都没收藏"
watch(
  () => auth.isLoggedIn,
  (v) => {
    if (v) void loadList(true)
  },
)

async function toggleExpand(item: ElegantListItem) {
  if (expandedId.value === item.termId) {
    expandedId.value = null
    return
  }
  expandedId.value = item.termId

  if (details.value[item.termId]) return // 取过就不再请求，也不重复加分

  loadingDetail.value = item.termId
  try {
    const d = await fetchElegantDetail(item.termId)
    details.value = { ...details.value, [item.termId]: d }
    // 展开即阅读，积分由这个接口顺带发放；重复展开后端返回 duplicate，apply 静默
    if (d.points) points.apply(d.points)
    announceBadges(d.newBadges)
    // 展开一组对照也算学习，顺手补当天打卡
    void checkin.run()
  } catch (e) {
    expandedId.value = null
    toast.bad((e as Error).message || '加载失败，请重试')
  } finally {
    loadingDetail.value = null
  }
}

function setFavorite(termId: number, v: boolean) {
  const it = list.value.find((x) => x.termId === termId)
  if (it) it.favorited = v
  const d = details.value[termId]
  if (d) d.favorited = v
}

function onToggleFavorite(item: ElegantListItem) {
  void toggle(item.termId, item.favorited, (v) => setFavorite(item.termId, v))
}

onMounted(() => void loadList(true))
</script>

<template>
  <div class="pb-20">
    <PageHeader title="雅词积累" subtitle="同一个意思，换一种更文雅的说法" />

    <!-- 搜的是"那个雅词"也能搜到：孩子往往记得「无与伦比」，忘了它对应哪个热梗 -->
    <div class="relative mb-4">
      <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-weak">🔍</span>
      <input
        v-model="keyword"
        type="search"
        class="input pl-10 pr-10"
        placeholder="搜热梗或雅词，如「yyds」"
        aria-label="搜索雅词"
      />
      <button
        v-if="searching"
        type="button"
        aria-label="清空搜索"
        class="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-ink-weak hover:bg-primary-soft"
        @click="keyword = ''"
      >
        ✕
      </button>
    </div>

    <h2 class="mb-2 text-sm font-medium text-ink-weak">
      <template v-if="searching">找到 {{ total }} 组对照</template>
      <template v-else>全部对照 · {{ total }} 组</template>
    </h2>

    <!-- 骨架屏：比转圈更能说明"马上有内容" -->
    <div v-if="loading" class="grid gap-3 md:grid-cols-2">
      <div v-for="i in 4" :key="i" class="card space-y-2">
        <div class="h-5 w-1/3 animate-pulse rounded bg-line/70" />
        <div class="h-4 w-2/3 animate-pulse rounded bg-line/70" />
      </div>
    </div>

    <AppCard v-else-if="error">
      <div class="py-6 text-center">
        <p class="text-sm text-bad">{{ error }}</p>
        <button type="button" class="btn-ghost mt-3 px-4 text-sm" @click="loadList(true)">
          重新加载
        </button>
      </div>
    </AppCard>

    <AppCard v-else-if="!list.length">
      <EmptyState
        :icon="searching ? '🔍' : '✒️'"
        :text="searching ? `雅词库没有「${keyword.trim()}」` : '还没有内容'"
        :hint="searching ? '也可以去辨析页看看这个词该怎么用' : ''"
      >
        <template v-if="searching">
          <RouterLink :to="{ path: '/terms', query: { q: keyword.trim() } }" class="chip mt-1">
            去「热梗辨析」搜「{{ keyword.trim() }}」→
          </RouterLink>
          <button
            type="button"
            class="mt-1 text-sm text-primary-deep underline underline-offset-4"
            @click="keyword = ''"
          >
            不对，我要看全部对照
          </button>
        </template>
      </EmptyState>
    </AppCard>

    <div v-else class="grid items-start gap-3 md:grid-cols-2">
      <div v-for="item in list" :key="item.termId" class="card relative">
        <button
          type="button"
          class="block w-full pr-10 text-left"
          :aria-expanded="expandedId === item.termId"
          @click="toggleExpand(item)"
        >
          <div class="flex items-center gap-2">
            <span class="font-medium">{{ item.name }}</span>
            <span class="chip">2 种更文雅的说法</span>
          </div>
          <p v-if="item.plainMeaning" class="mt-1 line-clamp-1 text-sm text-ink-weak">
            {{ item.plainMeaning }}
          </p>
          <p class="mt-1 text-xs text-primary-deep">
            {{ expandedId === item.termId ? '收起' : '展开看对照 →' }}
          </p>
        </button>

        <button
          type="button"
          class="absolute right-2 top-3 flex h-9 w-9 items-center justify-center rounded-full text-lg"
          :class="item.favorited ? 'text-accent' : 'text-ink-weak/70 hover:text-accent'"
          :disabled="busyId === item.termId"
          :aria-label="item.favorited ? '取消收藏' : '收藏'"
          :aria-pressed="item.favorited"
          @click="onToggleFavorite(item)"
        >
          {{ item.favorited ? '★' : '☆' }}
        </button>

        <Transition name="fade">
          <div v-if="expandedId === item.termId" class="mt-3 border-t border-line pt-3">
            <div v-if="loadingDetail === item.termId" class="space-y-2">
              <div class="h-4 w-1/3 animate-pulse rounded bg-line/70" />
              <div class="h-10 w-full animate-pulse rounded bg-line/70" />
            </div>

            <template v-else-if="details[item.termId]">
              <div class="space-y-2">
                <div
                  v-for="(w, i) in details[item.termId].words"
                  :key="w.word"
                  class="rounded-btn bg-primary-soft/60 p-3"
                >
                  <p class="flex items-baseline gap-2 font-medium text-primary-deep">
                    <span class="text-xs text-ink-weak">{{ i + 1 }}</span>
                    {{ w.word }}
                  </p>
                  <p class="mt-1 text-sm leading-6">{{ w.definition }}</p>
                </div>
              </div>

              <!-- 双向联动（T5.3）：有用法解析的词，直接跳去看"什么场合不能用" -->
              <RouterLink
                v-if="details[item.termId].hasHeuristic"
                :to="{ path: '/terms', query: { term: String(item.termId) } }"
                class="mt-3 inline-block text-sm text-primary-deep underline underline-offset-4"
              >
                看「{{ item.name }}」在什么场合不该用 →
              </RouterLink>
              <p v-else class="mt-3 text-xs text-ink-weak/80">
                辨析页暂未收录这个词的用法解析，这里只给替换说法。
              </p>
            </template>
          </div>
        </Transition>
      </div>
    </div>

    <button
      v-if="hasMore"
      type="button"
      class="btn-ghost mt-3 w-full"
      :disabled="loadingMore"
      @click="loadList(false)"
    >
      {{ loadingMore ? '加载中…' : `加载更多（还有 ${total - list.length} 组）` }}
    </button>

    <DailySentenceBar />
  </div>
</template>
