import { createRouter, createWebHistory } from 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    /** primary = 一级界面（首页/我的）；secondary = 二级页（左上角返回首页） */
    level?: 'primary' | 'secondary'
  }
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('@/views/Home.vue'), meta: { title: '首页', level: 'primary' } },
    { path: '/mine', name: 'mine', component: () => import('@/views/Mine.vue'), meta: { title: '我的', level: 'primary' } },

    { path: '/terms', name: 'terms', component: () => import('@/views/Terms.vue'), meta: { title: '热梗辨析', level: 'secondary' } },
    { path: '/elegant', name: 'elegant', component: () => import('@/views/Elegant.vue'), meta: { title: '雅词积累', level: 'secondary' } },
    { path: '/quiz', name: 'quiz', component: () => import('@/views/Quiz.vue'), meta: { title: '情景挑战', level: 'secondary' } },
    { path: '/quiz/play', name: 'quiz-play', component: () => import('@/views/QuizPlay.vue'), meta: { title: '答题中', level: 'secondary' } },
    { path: '/quiz/result', name: 'quiz-result', component: () => import('@/views/QuizResult.vue'), meta: { title: '本轮结果', level: 'secondary' } },
    { path: '/report', name: 'report', component: () => import('@/views/Report.vue'), meta: { title: '家校反馈', level: 'secondary' } },

    { path: '/login', name: 'login', component: () => import('@/views/Login.vue'), meta: { title: '登录' } },
    { path: '/privacy', name: 'privacy', component: () => import('@/views/Privacy.vue'), meta: { title: '隐私说明' } },
    { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('@/views/NotFound.vue'), meta: { title: '页面不存在' } },
  ],
  scrollBehavior() {
    return { top: 0 }
  },
})

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · 雅言小筑` : '雅言小筑'
})
