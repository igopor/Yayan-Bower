<script setup lang="ts">
import { useRouter } from 'vue-router'

withDefaults(defineProps<{ title: string; subtitle?: string; backTo?: string }>(), {
  backTo: '/',
})

const router = useRouter()
</script>

<template>
  <div class="mb-4 flex items-start gap-2">
    <button
      type="button"
      aria-label="返回首页"
      class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink-weak hover:text-primary"
      @click="router.push(backTo)"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M15 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <div class="min-w-0">
      <h1 class="text-xl font-semibold leading-9">{{ title }}</h1>
      <p v-if="subtitle" class="text-sm text-ink-weak">{{ subtitle }}</p>
    </div>
  </div>
</template>
