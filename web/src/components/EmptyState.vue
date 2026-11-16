<script setup lang="ts">
withDefaults(defineProps<{ text?: string; hint?: string; icon?: string }>(), {
  text: '这里还没有内容',
  icon: '🌱',
})
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
    <div class="text-4xl opacity-60">{{ icon }}</div>
    <p class="text-ink-weak">{{ text }}</p>
    <p v-if="hint" class="text-sm text-ink-weak/80">{{ hint }}</p>
    <slot />
  </div>
</template>
