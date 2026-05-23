import { createRouter, createWebHistory } from 'vue-router'
import { supabase } from '../lib/supabase'

const routes = [
  {
    path: '/auth',
    name: 'Auth',
    component: () => import('../views/AuthView.vue'),
  },
  {
    path: '/pets',
    name: 'Pets',
    component: () => import('../views/PetsView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/standby/:petId',
    name: 'Standby',
    component: () => import('../views/StandbyView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/guarding/:petId',
    name: 'Guarding',
    component: () => import('../views/GuardingView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/report/:sessionId',
    name: 'Report',
    component: () => import('../views/ReportView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/insights/:petId',
    name: 'Insights',
    component: () => import('../views/InsightsView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/voices/:petId',
    name: 'Voices',
    component: () => import('../views/VoicesView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/settings/:petId',
    name: 'Settings',
    component: () => import('../views/SettingsView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/reports/:petId',
    name: 'ReportsHistory',
    component: () => import('../views/ReportsHistoryView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/calibrate/:petId',
    name: 'Calibrate',
    component: () => import('../views/CalibrationView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/marking/:petId',
    name: 'Marking',
    component: () => import('../views/MarkingView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/audio-log/:petId',
    name: 'AudioLog',
    component: () => import('../views/AudioLogView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/',
    redirect: '/pets',
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach(async (to) => {
  const { data: { session } } = await supabase.auth.getSession()
  if (to.meta.requiresAuth && !session) return '/auth'
  if (to.path === '/auth' && session) return '/pets'
})

export default router
