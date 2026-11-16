/**
 * 6 枚徽章。定义写在代码里，不建表；只把"谁解锁了哪个"写进 user_badge。
 */
export interface BadgeDef {
  code: string
  name: string
  description: string
  /** 给前端的图标字符，后面换 SVG 只改这一处 */
  icon: string
}

export const BADGES: BadgeDef[] = [
  { code: 'FIRST_TERM', name: '初次查梗', description: '第一次打开热梗词条', icon: '📖' },
  { code: 'FIRST_QUIZ', name: '首次闯关', description: '完成第一轮情景挑战', icon: '🎯' },
  { code: 'QUIZ_PERFECT', name: '满分达人', description: '一轮闯关全部答对', icon: '🏆' },
  { code: 'STREAK_7', name: '七日不辍', description: '连续打卡满 7 天', icon: '🔥' },
  { code: 'FAVORITE_20', name: '收藏家', description: '累计收藏 20 条', icon: '⭐' },
  { code: 'POINTS_500', name: '积跬步', description: '累计获得 500 积分', icon: '🌱' },
]

export const BADGE_MAP = Object.fromEntries(BADGES.map((b) => [b.code, b]))
