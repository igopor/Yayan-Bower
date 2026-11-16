<script setup lang="ts">
import AppCard from '@/components/AppCard.vue'
import EmptyState from '@/components/EmptyState.vue'
</script>

<template>
  <AppCard>
    <EmptyState text="这个页面不存在" hint="地址可能敲错了，回首页看看" icon="🧭">
      <RouterLink to="/" class="btn-primary mt-2">回到首页</RouterLink>
    </EmptyState>
  </AppCard>
</template>
