import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { UserSummary } from '@shared/index'
import { apiGet, apiPost, tokenStore } from '@/api/http'

export interface SendCodeResult {
  cooldownSec: number
  /** 仅开发模式（Mock 短信通道）返回，方便直接填入 */
  mockCode?: string
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<UserSummary | null>(null)
  const loading = ref(false)

  /** 登录层是否打开。全局唯一，由 App.vue 渲染一次 */
  const loginOpen = ref(false)

  /**
   * 等待登录结果的回调队列。
   * 每个 requireLogin() 都会 push 一个 resolve，登录成功全部 resolve(true)，
   * 用户关掉弹层则全部 resolve(false)。这是"登录后回到原操作"的实现方式：
   * 不跳转、不刷新，调用方 await 之后就地继续。
   */
  const waiters: Array<(ok: boolean) => void> = []

  const isLoggedIn = computed(() => !!user.value)
  const points = computed(() => user.value?.totalPoints ?? 0)

  /** 启动时或登录后调用；未登录不报错，只是 user 保持 null */
  async function fetchMe() {
    if (!tokenStore.get()) {
      user.value = null
      return
    }
    loading.value = true
    try {
      user.value = await apiGet<UserSummary>('/auth/me', undefined, {
        skipAuthPrompt: true,
      })
    } catch {
      user.value = null
      tokenStore.clear()
    } finally {
      loading.value = false
    }
  }

  async function sendCode(phone: string): Promise<SendCodeResult> {
    return apiPost<SendCodeResult>('/auth/sms/send', { phone })
  }

  /**
   * 登录。`agreed` 是监护人同意的勾选结果 —— 服务端会再校验一次，
   * 前端这个参数只是把"用户确实勾了"传过去，不是唯一防线。
   */
  async function login(phone: string, code: string, agreed = false): Promise<UserSummary> {
    const data = await apiPost<{ token: string; user: UserSummary }>('/auth/sms/login', {
      phone,
      code,
      agreed,
    })
    tokenStore.set(data.token)
    user.value = data.user
    resolveWaiters(true)
    loginOpen.value = false
    return data.user
  }

  /** 需要登录才能做的事，先 await 这一句 */
  function requireLogin(): Promise<boolean> {
    if (user.value) return Promise.resolve(true)
    loginOpen.value = true
    return new Promise<boolean>((resolve) => {
      waiters.push(resolve)
    })
  }

  function resolveWaiters(ok: boolean) {
    const list = waiters.splice(0)
    list.forEach((fn) => fn(ok))
  }

  /** 用户主动关掉登录层 */
  function dismissLogin() {
    loginOpen.value = false
    resolveWaiters(false)
  }

  async function logout() {
    try {
      await apiPost('/auth/logout')
    } catch {
      // 服务端没有会话可清，失败也不影响本地登出
    }
    tokenStore.clear()
    user.value = null
  }

  /** 局部的积分增减后同步显示，避免每次都要重新拉 /me */
  function patchPoints(totalPoints: number, todayEarned: number) {
    if (!user.value) return
    user.value = { ...user.value, totalPoints, todayEarned }
  }

  return {
    user,
    loading,
    loginOpen,
    isLoggedIn,
    points,
    fetchMe,
    sendCode,
    login,
    requireLogin,
    dismissLogin,
    logout,
    patchPoints,
  }
})
