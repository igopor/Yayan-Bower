import { checkIn } from '@/api/mine'
import { useAuthStore } from '@/stores/auth'
import { usePoints } from '@/composables/usePoints'
import { announceBadges } from '@/composables/useBadge'
import { toast } from '@/composables/useToast'

/**
 * 自动打卡。
 *
 * 打卡的含义是"今天真的学过"，所以它不该挂在某个按钮上，也不该由孩子主动点。
 * 但"什么时候算学完了"只有前端知道 —— 后端只知道"今天有没有学习记录"。
 * 因此这里做成一个可以被随手调用的幂等动作：学完词条、展开雅词、闯关结算、
 * 以及每次进站/登录之后各调一次，服务端自己判断今天该不该发。
 *
 * 三个刻意的处理：
 *
 * 1. **静默失败。** 打卡是附赠功能，接口挂了不该让人以为网站坏了，也不该弹错误。
 * 2. **`no_activity` 不提示。** 一进网站就弹"你今天还没学习"是催人，不是这个产品的语气。
 * 3. **当天成功后不再请求。** 同一天里翻十个词条就是十次无意义的往返；
 *    记住日期键之后直接短路。`no_activity` 不记，否则学完第一个词条就再也不会补分了。
 */

/** 本地日期键，和后端 `dateKey` 同一套口径（不能用 UTC，否则早 8 点前算前一天） */
function todayKey(): string {
  const d = new Date()
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n))
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 已完成打卡的日期键。跨天会自动失效，不需要清理 */
let doneKey: string | null = null
/** 并发保护：一页里同时触发两处（比如弹层打开 + 结算）时只发一次 */
let inflight: Promise<void> | null = null

export function useCheckin() {
  const auth = useAuthStore()
  const points = usePoints()

  async function run(): Promise<void> {
    if (!auth.isLoggedIn) return
    if (doneKey === todayKey()) return
    if (inflight) return inflight

    inflight = (async () => {
      try {
        const r = await checkIn()
        // 今天已经打过：记下来，后面不再问
        if (r.reason === 'already') {
          doneKey = todayKey()
          return
        }
        // 今天还没学：不记，等真的学了再来问
        if (r.reason !== 'ok') return

        doneKey = todayKey()
        if (r.points) points.apply(r.points)
        if (r.streak >= 2) toast.ok(`连续 ${r.streak} 天来学习`)
        if (r.streakPoints?.granted) {
          toast.ok(`连续 ${r.streak} 天，额外 +${r.streakPoints.delta} 分`)
        }
        announceBadges(r.newBadges)
      } catch {
        /* 静默：打卡失败不影响任何主流程 */
      } finally {
        inflight = null
      }
    })()

    return inflight
  }

  return { run }
}
