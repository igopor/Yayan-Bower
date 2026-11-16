<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import PageHeader from '@/components/PageHeader.vue'
import AppCard from '@/components/AppCard.vue'
import LoginPanel from '@/components/LoginPanel.vue'
import { useAuthStore } from '@/stores/auth'

/**
 * 直接访问 /login 的落地页。
 * 表单本体与弹层共用 LoginPanel —— 两处逻辑一模一样的 UI 写两遍，
 * 迟早会出现"弹层能发验证码、页面不能"这类不一致。
 */
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

function onSuccess() {
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
  router.replace(redirect)
}
</script>

<template>
  <div>
    <PageHeader title="登录" back-to="/" />

    <AppCard>
      <div v-if="auth.isLoggedIn" class="py-4 text-center">
        <p class="text-base">你已登录：{{ auth.user?.nickname }}</p>
        <p class="mt-1 text-sm text-ink-weak">手机号 {{ auth.user?.phone }}</p>
        <button type="button" class="btn-primary mt-4 w-full" @click="router.replace('/')">
          回到首页
        </button>
      </div>
      <LoginPanel v-else @success="onSuccess" />
    </AppCard>
  </div>
</template>
