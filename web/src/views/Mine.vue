<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import PageHeader from '@/components/PageHeader.vue'
import AppCard from '@/components/AppCard.vue'
import AppLoading from '@/components/AppLoading.vue'
import EmptyState from '@/components/EmptyState.vue'
import TermDetailModal from '@/components/TermDetailModal.vue'
import { useAuthStore } from '@/stores/auth'
import { fetchMine } from '@/api/mine'
import { useFavorite } from '@/composables/useFavorite'
import type { MineView } from '@shared/index'

/**
 * 「我的」四区块：积分（醒目）、徽章墙、收藏夹、账号。
 *
 * 数据只调一个接口 `/api/mine`，一次画完 —— 拆成四个请求的话，
 * 手机上会看到"积分先出现、徽章两秒后才刷出来"，比多等一会儿更别扭。
 *
 * 未登录时不编假数据：整页换成登录引导。给未登录用户看一堆 0 分 0 徽章，
 * 他会以为自己学过了但什么都没得到。
 */

const auth = useAuthStore()
const router = useRouter()
const { toggle, busyId } = useFavorite()

const data = ref<MineView | null>(null)
const loading = ref(false)
const error = ref('')
const loggingOut = ref(false)
const detailId = ref<number | null>(null)
const detailOpen = ref(false)

const unlockedCount = computed(() => data.value?.badges.filter((b) => b.unlocked).length ?? 0)
const viewPercent = computed(() => {
  const p = data.value?.points
  if (!p || p.viewCap <= 0) return 0
  return Math.min(100, Math.round((p.todayView / p.viewCap) * 100))
})

async function load() {
  if (!auth.isLoggedIn) {
    data.value = null
    return
  }
  loading.value = true
  error.value = ''
  try {
    data.value = await fetchMine()
  } catch (e) {
    error.value = (e as Error).message || '加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

/** 收藏夹里点一条，打开同一个详情弹层（和辨析页共用，不为这里再写一套） */
function openDetail(termId: number) {
  detailId.value = termId
  detailOpen.value = true
}

/** 在详情里取消了收藏，列表要同步 —— 否则关掉弹层还看到那一条 */
function onFavoriteToggled(id: number, favorited: boolean) {
  if (favorited || !data.value) return
  data.value.favorites = data.value.favorites.filter((f) => f.termId !== id)
}

async function removeFavorite(termId: number) {
  await toggle(termId, true, (v) => {
    if (!v) onFavoriteToggled(termId, false)
  })
}

async function logout() {
  loggingOut.value = true
  try {
    await auth.logout()
    data.value = null
    await router.push('/')
  } finally {
    loggingOut.value = false
  }
}

onMounted(load)
// 在登录层里登录成功后回到本页，需要把数据补上
watch(() => auth.isLoggedIn, () => void load())
</script>

<template>
  <div class="md:mx-auto md:max-w-3xl">
    <PageHeader title="我的" subtitle="积分、徽章、收藏与账号" />

    <!-- 未登录：整页换成引导，不显示任何数字 -->
    <AppCard v-if="!auth.isLoggedIn">
      <EmptyState text="登录后才有积分和徽章" hint="用手机号登录，学习记录会一直留在你的账号里" icon="🔑">
        <button type="button" class="btn-primary mt-2 px-6" @click="auth.requireLogin()">
          手机号登录
        </button>
      </EmptyState>
    </AppCard>

    <template v-else>
      <AppCard v-if="loading && !data">
        <AppLoading text="正在加载…" />
      </AppCard>

      <AppCard v-else-if="error">
        <div class="py-6 text-center">
          <p class="text-sm text-bad">{{ error }}</p>
          <button type="button" class="btn-ghost mt-3 px-4 text-sm" @click="load">重试</button>
        </div>
      </AppCard>

      <template v-else-if="data">
        <!-- ① 积分：全页最大的字，孩子一眼看到"我攒了多少" -->
        <AppCard>
          <div class="flex items-start justify-between">
            <div>
              <p class="text-xs text-ink-weak">总积分</p>
              <p class="mt-0.5 text-4xl font-semibold tabular-nums leading-tight text-primary-deep">
                {{ data.points.total }}
              </p>
              <p class="mt-1 text-xs text-ink-weak">
                今天 +{{ data.points.today }}
                <span v-if="data.checkedInToday" class="text-ok">· 已打卡</span>
                <span v-else class="text-ink-weak/70">· 今天还没开始</span>
              </p>
            </div>
            <div class="text-right">
              <p class="text-2xl font-semibold tabular-nums text-accent">{{ data.streak }}</p>
              <p class="text-xs text-ink-weak">连续天数</p>
            </div>
          </div>

          <!-- 浏览类有每日上限，给出进度比只显示"今天 +8"更清楚 -->
          <div class="mt-4">
            <div class="flex items-center justify-between text-xs text-ink-weak">
              <span>今日浏览积分</span>
              <span class="tabular-nums">{{ data.points.todayView }} / {{ data.points.viewCap }}</span>
            </div>
            <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-primary-soft">
              <div class="h-full rounded-full bg-primary transition-all" :style="{ width: `${viewPercent}%` }" />
            </div>
          </div>

          <div class="mt-4 grid grid-cols-3 divide-x divide-line border-t border-line pt-3 text-center">
            <div>
              <p class="text-lg font-semibold tabular-nums">{{ data.termCount }}</p>
              <p class="text-xs text-ink-weak">查过词条</p>
            </div>
            <div>
              <p class="text-lg font-semibold tabular-nums">{{ data.quizRounds }}</p>
              <p class="text-xs text-ink-weak">闯关轮次</p>
            </div>
            <div>
              <p class="text-lg font-semibold tabular-nums">{{ data.favorites.length }}</p>
              <p class="text-xs text-ink-weak">收藏</p>
            </div>
          </div>
        </AppCard>

        <!-- ② 徽章墙：解锁的亮、未解锁的灰，但说明一律显示 -->
        <AppCard class="mt-3" title="徽章墙">
          <template #extra>
            <span class="text-xs text-ink-weak tabular-nums">{{ unlockedCount }} / {{ data.badges.length }}</span>
          </template>

          <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div
              v-for="badge in data.badges"
              :key="badge.code"
              class="rounded-btn border px-3 py-2.5 transition"
              :class="badge.unlocked ? 'border-accent/40 bg-accent/5' : 'border-line bg-bg/40'"
            >
              <div class="flex items-center gap-1.5">
                <span class="text-lg" :class="badge.unlocked ? '' : 'opacity-30 grayscale'">
                  {{ badge.icon }}
                </span>
                <span class="text-sm font-medium" :class="badge.unlocked ? 'text-ink' : 'text-ink-weak'">
                  {{ badge.name }}
                </span>
              </div>
              <!-- 说明不隐藏：孩子看到"怎么才能拿到"才会去争取 -->
              <p class="mt-1 text-[11px] leading-4 text-ink-weak/80">{{ badge.description }}</p>
              <p v-if="badge.unlocked" class="mt-1 text-[11px] text-accent">已解锁</p>
              <p v-else class="mt-1 text-[11px] text-ink-weak/60">未解锁</p>
            </div>
          </div>
        </AppCard>

        <!-- ③ 收藏夹 -->
        <AppCard class="mt-3" title="收藏夹">
          <template #extra>
            <RouterLink
              to="/terms"
              class="inline-flex h-8 items-center px-1 text-xs text-primary"
            >去辨析页</RouterLink>
          </template>

          <EmptyState
            v-if="data.favorites.length === 0"
            text="还没有收藏"
            hint="看到用得上的说法，点一下 ☆ 就会存到这里"
            icon="⭐"
          />

          <ul v-else class="-mx-1 divide-y divide-line">
            <li v-for="f in data.favorites" :key="f.termId" class="flex items-center gap-2">
              <button
                type="button"
                class="min-w-0 flex-1 py-2.5 pl-1 text-left"
                @click="openDetail(f.termId)"
              >
                <p class="truncate text-sm font-medium text-ink">{{ f.name }}</p>
                <p class="mt-0.5 line-clamp-1 text-xs text-ink-weak">{{ f.plainMeaning }}</p>
              </button>
              <button
                type="button"
                class="inline-flex h-9 shrink-0 items-center justify-center rounded-full px-3 text-xs text-ink-weak hover:text-bad"
                :disabled="busyId === f.termId"
                @click.stop="removeFavorite(f.termId)"
              >
                取消
              </button>
            </li>
          </ul>
          <p v-if="data.favorites.length > 0" class="mt-2 text-xs text-ink-weak/70">
            取消收藏不会扣分，之前拿到的积分不会退回。
          </p>
        </AppCard>

        <!-- ④ 账号 -->
        <AppCard class="mt-3" title="账号">
          <div class="space-y-2 text-sm">
            <div class="flex items-center justify-between">
              <span class="text-ink-weak">昵称</span>
              <span>{{ data.user.nickname }}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-ink-weak">手机号</span>
              <span class="tabular-nums">{{ data.user.phone }}</span>
            </div>
          </div>
          <button
            type="button"
            class="btn-ghost mt-4 w-full text-sm"
            :disabled="loggingOut"
            @click="logout"
          >
            {{ loggingOut ? '正在退出…' : '退出登录' }}
          </button>
        </AppCard>
      </template>
    </template>

    <TermDetailModal
      v-model="detailOpen"
      :term-id="detailId"
      @favorite-toggled="onFavoriteToggled"
    />
  </div>
</template>
