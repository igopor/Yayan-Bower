<script setup lang="ts">
withDefaults(defineProps<{ text?: string }>(), { text: '加载中…' })
</script>

<template>
  <div class="flex items-center justify-center gap-2 py-10 text-sm text-ink-weak">
    <span class="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-primary" />
    {{ text }}
  </div>
</template>
