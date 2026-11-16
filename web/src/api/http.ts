import axios from 'axios'
import { ERR, type ApiOk } from '@shared/index'

const TOKEN_KEY = 'yyxz_token'

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

declare module 'axios' {
  export interface AxiosRequestConfig {
    /**
     * 跳过"未登录 → 弹登录层"的自动处理。
     * 用在启动时的 /auth/me 探测：token 过期是正常现象，
     * 静默清掉即可，不应该一进页面就糊一个登录框在用户脸上。
     */
    skipAuthPrompt?: boolean
  }
}

export const http = axios.create({
  baseURL: '/api',
  timeout: 15000,
})

http.interceptors.request.use((cfg) => {
  const t = tokenStore.get()
  if (t) cfg.headers.Authorization = `Bearer ${t}`
  return cfg
})

/**
 * 未登录 / token 失效时的统一处理。
 *
 * 这里**不跳转**到 /login。原因：跳转会刷新页面，用户在页面上填了一半的
 * 状态（搜索词、滚动位置、答题进度）全部丢失，"登录后回到原位"就成了一句空话。
 * 改成派发一个事件，由 App.vue 弹出登录层，登录完成后调用方继续执行原来的操作。
 */
function handleUnauthorized(skip: boolean) {
  tokenStore.clear()
  if (!skip) window.dispatchEvent(new Event('app:unauthorized'))
}

function isUnauthorized(code: unknown) {
  return code === ERR.UNAUTHORIZED
}

http.interceptors.response.use(
  (res) => {
    const body = res.data as ApiOk<unknown>
    if (body && typeof body.code === 'number' && body.code !== 0) {
      // 鉴权失败走后端业务码（HTTP 200 + code 40100），不是 HTTP 401
      if (isUnauthorized(body.code)) handleUnauthorized(!!res.config.skipAuthPrompt)
      return Promise.reject(Object.assign(new Error(body.message), { code: body.code }))
    }
    return res
  },
  (err) => {
    const code = err?.response?.data?.code
    const message = err?.response?.data?.message ?? '网络异常，请稍后重试'

    if (isUnauthorized(code)) handleUnauthorized(!!err.config?.skipAuthPrompt)

    return Promise.reject(Object.assign(new Error(message), { code }))
  },
)

/** 取出 data 层的封装，业务代码只关心返回值 */
export async function apiGet<T>(
  url: string,
  params?: Record<string, unknown>,
  config?: { skipAuthPrompt?: boolean },
): Promise<T> {
  const res = await http.get<ApiOk<T>>(url, { params, ...config })
  return res.data.data
}

export async function apiPost<T>(url: string, body?: unknown): Promise<T> {
  const res = await http.post<ApiOk<T>>(url, body)
  return res.data.data
}

export async function apiDelete<T>(url: string, body?: unknown): Promise<T> {
  const res = await http.delete<ApiOk<T>>(url, { data: body })
  return res.data.data
}
