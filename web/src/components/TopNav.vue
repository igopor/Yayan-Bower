<script setup lang="ts">
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const auth = useAuthStore()

const tabs = [
  { name: 'home', label: '首页', to: '/' },
  { name: 'mine', label: '我的', to: '/mine' },
]

function openLogin() {
  void auth.requireLogin()
}
</script>

<template>
  <header class="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
    <div class="mx-auto flex h-14 max-w-page items-center justify-between px-4 md:px-6">
      <RouterLink to="/" class="flex items-center gap-2">
        <span class="text-lg font-semibold tracking-wide text-primary-deep">雅言小筑</span>
      </RouterLink>

      <nav class="flex items-center gap-1">
        <RouterLink
          v-for="t in tabs"
          :key="t.name"
          :to="t.to"
          class="btn min-h-[36px] px-3 text-sm"
          :class="route.name === t.name ? 'bg-primary-soft text-primary-deep' : 'text-ink-weak'"
        >
          {{ t.label }}
        </RouterLink>

        <span
          v-if="auth.isLoggedIn"
          class="ml-2 rounded-full bg-accent/15 px-3 py-1 text-sm font-medium text-accent"
        >
          {{ auth.points }} 分
        </span>
        <button
          v-else
          type="button"
          class="btn-ghost ml-2 min-h-[36px] px-3 text-sm"
          @click="openLogin"
        >
          登录
        </button>
      </nav>
    </div>
  </header>
</template>
