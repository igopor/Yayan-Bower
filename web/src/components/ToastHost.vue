<script setup lang="ts">
import { useToastState } from '@/composables/useToast'

const { items } = useToastState()

const tone: Record<string, string> = {
  info: 'bg-ink text-white',
  ok: 'bg-ok text-white',
  bad: 'bg-bad text-white',
  point: 'bg-accent text-white',
  badge: 'bg-primary-deep text-white',
}
</script>

<template>
  <Teleport to="body">
    <!-- z 要高于所有弹层：弹层打开时的操作反馈（如"已收藏"）不该被遮住 -->
    <div class="pointer-events-none fixed inset-x-0 top-16 z-[90] flex flex-col items-center gap-2">
      <TransitionGroup name="fade">
        <div
          v-for="t in items"
          :key="t.id"
          class="rounded-full px-4 py-2 text-sm shadow-float"
          :class="tone[t.type]"
        >
          {{ t.text }}
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
