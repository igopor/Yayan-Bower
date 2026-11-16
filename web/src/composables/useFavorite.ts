import { ref } from 'vue'
import { favoriteTerm, unfavoriteTerm } from '@/api/content'
import { useAuthStore } from '@/stores/auth'
import { usePoints } from '@/composables/usePoints'
import { announceBadges } from '@/composables/useBadge'
import { toast } from '@/composables/useToast'

/**
 * 收藏切换。列表页、详情弹层、雅词页、「我的」都用这一份。
 *
 * 为什么抽出来：三处界面都要"点了立刻变色 + 未登录先弹登录 + 失败回滚 + 加分提示"，
 * 各写一遍必然出现三种行为（有的先弹登录、有的先变色、有的失败不回滚）。
 *
 * 调用方只需传一个 setter，由它决定"这个 id 的收藏态存在哪"：
 * 列表里是一条数据、详情里是当前这一条、我的页是一个卡片。
 */
export function useFavorite() {
  const auth = useAuthStore()
  const points = usePoints()
  const busyId = ref<number | null>(null)

  /**
   * @param termId 词条 id
   * @param current 当前收藏态（取反用）
   * @param apply 写入新状态。乐观更新和回滚都通过它，调用方不用关心时机
   */
  async function toggle(termId: number, current: boolean, apply: (v: boolean) => void) {
    if (busyId.value === termId) return // 连点两下只发一个请求

    // 未登录先弹登录层。登录成功后继续往下走，用户不用再点一次收藏。
    if (!(await auth.requireLogin())) return

    const target = !current
    apply(target) // 乐观更新：不等网络
    busyId.value = termId

    try {
      const r = target ? await favoriteTerm(termId) : await unfavoriteTerm(termId)
      // 取消收藏时后端返回 points=null，apply 会忽略，不会扣分也不会飘字
      if (r.points) points.apply(r.points)
      announceBadges(r.newBadges)
      apply(r.favorited)
      toast.ok(r.favorited ? '已收藏' : '已取消收藏')
    } catch (e) {
      apply(current) // 失败回滚：不能让孩子看到假的收藏状态
      toast.bad((e as Error).message || '操作失败')
    } finally {
      busyId.value = null
    }
  }

  return { toggle, busyId }
}
