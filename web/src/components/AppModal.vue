<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { acquireModal, type ModalHandle } from '@/lib/modal-stack'

const props = withDefaults(
  defineProps<{ modelValue: boolean; title?: string; closable?: boolean }>(),
  { closable: true },
)
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

/** 打开时才申请，关闭即释放；z-index 与滚动锁都由它统一管理 */
const handle = ref<ModalHandle | null>(null)

function close() {
  if (props.closable) emit('update:modelValue', false)
}

function onKey(e: KeyboardEvent) {
  // 被上层弹层盖住时不响应：否则词条详情里弹出登录框，一次 Esc 会关掉两层
  if (!handle.value?.isTop()) return
  if (e.key === 'Escape') close()
}

function onBackdrop() {
  if (!handle.value?.isTop()) return
  close()
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      if (!handle.value) handle.value = acquireModal()
      window.addEventListener('keydown', onKey)
    } else {
      window.removeEventListener('keydown', onKey)
      handle.value?.release()
      handle.value = null
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  handle.value?.release()
  handle.value = null
})
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="modelValue"
        class="fixed inset-0 flex items-center justify-center bg-black/35 p-4"
        :style="{ zIndex: handle?.zIndex ?? 50 }"
        @click.self="onBackdrop"
      >
        <div class="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-card bg-surface p-5 shadow-float">
          <div v-if="title" class="mb-3 flex items-start justify-between gap-3">
            <h2 class="text-lg font-semibold">{{ title }}</h2>
            <button
              v-if="closable"
              type="button"
              aria-label="关闭"
              class="text-ink-weak hover:text-ink"
              @click="close"
            >
              ✕
            </button>
          </div>
          <slot />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
