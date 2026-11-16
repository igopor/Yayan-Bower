import type {
  DailySentence,
  ElegantDetailView,
  ElegantListItem,
  FavoriteResult,
  Paged,
  TermDetailView,
  TermListItem,
  TermListPage,
} from '@shared/index'
import { apiDelete, apiGet, apiPost } from './http'

/**
 * 热梗辨析相关接口。页面只调这里的函数，不直接写 url ——
 * 将来接口路径变了，改这一个文件就够。
 */

export function fetchFeaturedTerms() {
  return apiGet<TermListItem[]>('/terms/featured')
}

export function fetchTerms(params: { keyword?: string; page?: number }) {
  return apiGet<TermListPage>('/terms', params)
}

/**
 * @param source 从辨析页来传 terms，从雅词页反查进来传 elegant。
 *               决定这次浏览记哪种积分（两者共用同一个每日上限）。
 *               注意副作用：这个 GET 会给登录用户加浏览积分。
 */
export function fetchTermDetail(id: number, source: 'terms' | 'elegant' = 'terms') {
  return apiGet<TermDetailView>(`/terms/${id}`, { source })
}

export function favoriteTerm(termId: number) {
  return apiPost<FavoriteResult>('/favorites', { termId })
}

export function unfavoriteTerm(termId: number) {
  return apiDelete<FavoriteResult>(`/favorites/${termId}`)
}

// ── 雅词积累 ─────────────────────────────────────

export function fetchElegantList(params: { keyword?: string; page?: number }) {
  return apiGet<Paged<ElegantListItem>>('/elegant', params)
}

/**
 * 展开一组对照。
 * 注意副作用：这个 GET 会给登录用户加 `ELEGANT_VIEW` 浏览积分（幂等，同一组一天一次）。
 */
export function fetchElegantDetail(termId: number) {
  return apiGet<ElegantDetailView>(`/elegant/${termId}`)
}

export function fetchDailySentence() {
  return apiGet<DailySentence>('/elegant/daily-sentence')
}
