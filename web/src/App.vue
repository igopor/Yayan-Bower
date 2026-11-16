<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue'
import TopNav from '@/components/TopNav.vue'
import ToastHost from '@/components/ToastHost.vue'
import LoginModal from '@/components/LoginModal.vue'
import { useAuthStore } from '@/stores/auth'
import { useCheckin } from '@/composables/useCheckin'

const auth = useAuthStore()
const checkin = useCheckin()

/**
 * 任何接口返回 40100 时，http 拦截器会派发这个事件。
 * 这里统一弹登录层，不刷新页面 —— 用户手上的输入和进度都还在。
 */
function onUnauthorized() {
  void auth.requireLogin()
}

/**
 * 进站/登录后先问一次打卡。
 *
 * 这里只覆盖"昨天学过、今天一进来就补上"的情况 ——
 * 真正让当天拿得到打卡分的是学习动作结束后的那次调用（见 useCheckin 注释）。
 */
watch(
  () => auth.isLoggedIn,
  (v) => {
    if (v) void checkin.run()
  },
  { immediate: true },
)

onMounted(() => {
  void auth.fetchMe()
  window.addEventListener('app:unauthorized', onUnauthorized)
})

onBeforeUnmount(() => {
  window.removeEventListener('app:unauthorized', onUnauthorized)
})
</script>

<template>
  <div class="min-h-screen bg-bg">
    <TopNav />
    <main class="mx-auto w-full max-w-page px-4 pb-20 pt-4 md:px-6">
      <RouterView v-slot="{ Component }">
        <Transition name="fade" mode="out-in">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>
    <ToastHost />
    <LoginModal />
  </div>
</template>
