<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageHeader from '@/components/PageHeader.vue'
import EmptyState from '@/components/EmptyState.vue'
import AppCard from '@/components/AppCard.vue'
import TermDetailModal from '@/components/TermDetailModal.vue'
import { fetchFeaturedTerms, fetchTerms } from '@/api/content'
import type { TermListItem } from '@shared/index'
import { useAuthStore } from '@/stores/auth'
import { useFavorite } from '@/composables/useFavorite'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const { toggle, busyId } = useFavorite()

/** 从雅词页空状态跳过来会带 `?q=`，直接预填；`?term=<id>` 则直接打开该词详情 */
const keyword = ref(typeof route.query.q === 'string' ? route.query.q : '')
const featured = ref<TermListItem[]>([])
const list = ref<TermListItem[]>([])
const page = ref(1)
const total = ref(0)
const hasMore = ref(false)
/** 零结果但雅词库里有这个词时，后端返回词名，用于给出"去那边看看"的指引 */
const elegantHint = ref<string | null>(null)

const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')

const detailId = ref<number | null>(null)
const detailOpen = ref(false)

const searching = computed(() => keyword.value.trim().length > 0)
/** 搜索时收起精选区：结果区才是用户此刻要看的东西 */
const showFeatured = computed(() => !searching.value && featured.value.length > 0)

async function loadFeatured() {
  try {
    featured.value = await fetchFeaturedTerms()
  } catch {
    // 精选区失败不影响主列表，静默降级（少一个区块，页面照样能用）
    featured.value = []
  }
}

async function loadList(reset: boolean) {
  if (reset) {
    loading.value = true
    error.value = ''
  } else {
    loadingMore.value = true
  }

  try {
    const target = reset ? 1 : page.value + 1
    const r = await fetchTerms({ keyword: keyword.value.trim(), page: target })
    list.value = reset ? r.items : [...list.value, ...r.items]
    page.value = r.page
    total.value = r.total
    hasMore.value = r.hasMore
    elegantHint.value = r.elegantHint ?? null
  } catch (e) {
    error.value = (e as Error).message || '加载失败'
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

/**
 * 防抖 300ms。每敲一个字就请求一次的话，手机上打一个词会发出 5 个请求，
 * 返回顺序还可能乱掉（后发的先回），列表就闪成别的字的结果。
 */
let debounceTimer: number | undefined
watch(keyword, () => {
  window.clearTimeout(debounceTimer)
  debounceTimer = window.setTimeout(() => {
    // 把搜索词写进地址栏：刷新不丢、也能直接把"搜这个词"的链接发给别人
    const q = keyword.value.trim()
    if ((route.query.q ?? '') !== q) {
      void router.replace({ query: { ...route.query, q: q || undefined } })
    }
    void loadList(true)
  }, 300)
})
onBeforeUnmount(() => window.clearTimeout(debounceTimer))

// 登录成功后重拉一次：收藏态是跟着用户走的，不刷新会显示成"一个都没收藏"
watch(
  () => auth.isLoggedIn,
  (v) => {
    if (!v) return
    void loadFeatured()
    void loadList(true)
  },
)

/** 一个 id 的收藏态可能同时出现在精选区和列表里，两处都要改 */
function setFavorite(id: number, v: boolean) {
  for (const arr of [featured.value, list.value]) {
    const it = arr.find((x) => x.id === id)
    if (it) it.favorited = v
  }
}

function onToggleFavorite(item: TermListItem) {
  void toggle(item.id, item.favorited, (v) => setFavorite(item.id, v))
}

function openDetail(id: number) {
  detailId.value = id
  detailOpen.value = true
}

/**
 * 从雅词页「看它在什么场合不该用」跳过来时带 `?term=<id>`，直接开这张详情。
 * 关掉弹层后把 term 参数抹掉——否则刷新又弹一次，用户会以为关不掉。
 */
watch(detailOpen, (open) => {
  if (open || !route.query.term) return
  void router.replace({ query: { ...route.query, term: undefined } })
})

onMounted(() => {
  const raw = route.query.term
  const id = Number(raw)
  if (raw && Number.isInteger(id) && id > 0) openDetail(id)
  void loadFeatured()
  void loadList(true)
})
</script>

<template>
  <div>
    <PageHeader title="热梗辨析" subtitle="什么场合能说，什么场合换一种说法" />

    <!-- 搜索 -->
    <div class="relative mb-4">
      <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-weak">🔍</span>
      <input
        v-model="keyword"
        type="search"
        class="input pl-10 pr-10"
        placeholder="搜热梗名称或意思，比如「绝绝子」"
        aria-label="搜索热梗"
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

    <!-- 精选固定展示：移动端横滑，PC 三列 -->
    <section v-if="showFeatured" class="mb-5">
      <h2 class="mb-2 text-sm font-medium text-ink-weak">精选 · 最常听到的 10 个</h2>
      <div
        class="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0"
      >
        <div
          v-for="t in featured"
          :key="t.id"
          class="relative w-[240px] shrink-0 snap-start rounded-card bg-surface p-3 shadow-card md:w-auto"
        >
          <button type="button" class="block w-full pr-8 text-left" @click="openDetail(t.id)">
            <p class="font-medium">{{ t.name }}</p>
            <p class="mt-1 line-clamp-2 text-sm leading-6 text-ink-weak">{{ t.plainMeaning }}</p>
          </button>
          <button
            type="button"
            class="absolute right-1.5 top-1.5 flex h-9 w-9 items-center justify-center rounded-full text-lg"
            :class="t.favorited ? 'text-accent' : 'text-ink-weak/70 hover:text-accent'"
            :disabled="busyId === t.id"
            :aria-label="t.favorited ? '取消收藏' : '收藏'"
            :aria-pressed="t.favorited"
            @click="onToggleFavorite(t)"
          >
            {{ t.favorited ? '★' : '☆' }}
          </button>
        </div>
      </div>
    </section>

    <!-- 列表 -->
    <section>
      <h2 class="mb-2 text-sm font-medium text-ink-weak">
        <template v-if="searching">找到 {{ total }} 个词条</template>
        <template v-else>全部词条 · {{ total }} 个</template>
      </h2>

      <!-- 首屏骨架：比转圈更能说明"马上有内容" -->
      <div v-if="loading" class="space-y-3">
        <div v-for="i in 3" :key="i" class="card space-y-2">
          <div class="h-5 w-1/3 animate-pulse rounded bg-line/70" />
          <div class="h-4 w-4/5 animate-pulse rounded bg-line/70" />
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
          :icon="searching ? '🔍' : '🌱'"
          :text="searching ? `没有找到「${keyword.trim()}」` : '还没有词条'"
          :hint="
            searching
              ? elegantHint
                ? '辨析页没有收录它的用法解析，但雅词库里有它的替换说法'
                : '试试搜它的别称，或者只打两个字'
              : ''
          "
        >
          <!--
            搜不到不等于网站没有：这个词可能只收在雅词页（没有用法解析）。
            所以只要在搜索中，空状态一定给一条出路——要么直达该词，要么带着词去雅词页翻，
            再不行就退回全部列表。只给一句"没找到"，孩子会以为整个网站没有这个词。
          -->
          <template v-if="searching">
            <RouterLink
              v-if="elegantHint"
              to="/elegant"
              class="chip mt-1"
            >
              去「雅词积累」看「{{ elegantHint }}」→
            </RouterLink>
            <RouterLink
              v-else
              :to="{ path: '/elegant', query: { q: keyword.trim() } }"
              class="chip mt-1"
            >
              去「雅词积累」搜「{{ keyword.trim() }}」→
            </RouterLink>
            <button
              type="button"
              class="mt-1 text-sm text-primary-deep underline underline-offset-4"
              @click="keyword = ''"
            >
              不对，我要看全部词条
            </button>
          </template>
        </EmptyState>
      </AppCard>

      <div v-else class="space-y-3">
        <div
          v-for="t in list"
          :key="t.id"
          class="card relative transition hover:shadow-float"
        >
          <button type="button" class="block w-full pr-10 text-left" @click="openDetail(t.id)">
            <div class="flex items-center gap-2">
              <span class="font-medium">{{ t.name }}</span>
              <span v-if="t.hasElegant" class="chip">有雅词替换</span>
            </div>
            <p class="mt-1 line-clamp-2 text-sm leading-6 text-ink-weak">{{ t.plainMeaning }}</p>
          </button>
          <button
            type="button"
            class="absolute right-2 top-3 flex h-9 w-9 items-center justify-center rounded-full text-lg"
            :class="t.favorited ? 'text-accent' : 'text-ink-weak/70 hover:text-accent'"
            :disabled="busyId === t.id"
            :aria-label="t.favorited ? '取消收藏' : '收藏'"
            :aria-pressed="t.favorited"
            @click="onToggleFavorite(t)"
          >
            {{ t.favorited ? '★' : '☆' }}
          </button>
        </div>

        <button
          v-if="hasMore"
          type="button"
          class="btn-ghost w-full"
          :disabled="loadingMore"
          @click="loadList(false)"
        >
          {{ loadingMore ? '加载中…' : `加载更多（还有 ${total - list.length} 个）` }}
        </button>
      </div>
    </section>

    <TermDetailModal
      v-model="detailOpen"
      :term-id="detailId"
      @favorite-toggled="setFavorite"
    />
  </div>
</template>
