import type { BadgeDef } from '@shared/index'
import { toast } from './useToast'

/**
 * 徽章解锁提示。
 *
 * 徽章解锁是"事后判定"的：孩子在查词条/收藏/结算的那一刻才满足条件，
 * 后端在那个接口的返回体里顺带带上 `newBadges`。
 * 如果前端不在这里提示一句，徽章墙会悄悄多一格，孩子根本不知道。
 *
 * 为什么不做成弹窗：解锁常常发生在"正在看内容"的中间，弹窗会打断阅读。
 * 飘一行字就够了，想看细节去「我的」。
 */
export function announceBadges(list?: BadgeDef[] | null) {
  if (!list || list.length === 0) return
  for (const badge of list) {
    toast.badge(`${badge.icon} 解锁徽章「${badge.name}」`)
  }
}
