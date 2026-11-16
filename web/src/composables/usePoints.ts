import type { GrantResult, PointsSummary } from '@shared/index'
import { apiGet } from '@/api/http'
import { useAuthStore } from '@/stores/auth'
import { toast } from '@/composables/useToast'

/**
 * 积分反馈。业务模块拿到后端的 GrantResult 后调一次 `apply()`，
 * 顶栏数字和飘字提示就都对了 —— 各模块不各自写一遍"加分后怎么显示"。
 */
export function usePoints() {
  const auth = useAuthStore()

  /**
   * 同步一处积分变动的显示。
   * 用后端返回的 balance 直接覆盖，而不是前端自己 `+=`：
   * 并发或被日上限拦截时，前端算出来的值会和真实余额不一致。
   */
  function apply(result: GrantResult) {
    if (result.granted && result.delta > 0) {
      const todayEarned = (auth.user?.todayEarned ?? 0) + result.delta
      auth.patchPoints(result.balance, todayEarned)
      toast.point(`+${result.delta} 分`)
      return
    }

    if (result.reason === 'daily_cap') {
      // 只在被日上限拦住时提示。duplicate 静默——用户刷新或重复打开同一页
      // 本来就是常见操作，每次都弹"这个你已经看过了"会很吵。
      toast.info('今天的学习积分已经攒满，明天再来')
      return
    }
    // duplicate：什么都不做
  }

  /** 从服务端重新拉一次概览，用于页面初始化或不确定本地状态时 */
  async function refresh() {
    if (!auth.isLoggedIn) return null
    const s = await apiGet<PointsSummary>('/points/summary')
    auth.patchPoints(s.total, s.today)
    return s
  }

  return { apply, refresh }
}
