<script setup lang="ts">
withDefaults(defineProps<{ title?: string; padded?: boolean }>(), { padded: true })
</script>

<template>
  <section class="card" :class="padded ? '' : 'p-0'">
    <header v-if="title" class="mb-3 flex items-center justify-between">
      <h2 class="text-base font-semibold">{{ title }}</h2>
      <slot name="extra" />
    </header>
    <slot />
  </section>
</template>
