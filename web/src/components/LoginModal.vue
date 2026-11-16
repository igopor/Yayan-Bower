<script setup lang="ts">
import AppModal from '@/components/AppModal.vue'
import LoginPanel from '@/components/LoginPanel.vue'
import { useAuthStore } from '@/stores/auth'

/**
 * 全局登录层。由 App.vue 渲染一次，任何地方调用
 * `await auth.requireLogin()` 都会把它弹出来，登录成功后调用方接着往下走。
 */
const auth = useAuthStore()

function onVisibleChange(open: boolean) {
  if (!open) auth.dismissLogin()
}
</script>

<template>
  <AppModal
    :model-value="auth.loginOpen"
    title="登录雅言小筑"
    @update:model-value="onVisibleChange"
  >
    <!--
      不用监听 LoginPanel 的 success：auth.login() 成功后已经把 loginOpen 置为 false
      并 resolve 了所有等待者，弹层会跟着 model-value 自动关闭。
    -->
    <LoginPanel />
  </AppModal>
</template>
