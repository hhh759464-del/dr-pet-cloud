<script setup>
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { supabase } from '../lib/supabase'
import { useAudio } from '../composables/useAudio'

const router = useRouter()
const route = useRoute()
const { hasCalibration, setCalibration } = useAudio()

const pet = ref(null)
const lastSession = ref(null)
const unmarkedCount = ref(0)
const showDebug = ref(false)
const needsCalibration = ref(true)
const calibrationChecked = ref(false)

function skipCalibration() {
  needsCalibration.value = false
}

function checkCalibration() {
  if (calibrationChecked.value) return
  needsCalibration.value = !hasCalibration()
  calibrationChecked.value = true
}

onMounted(async () => {
  const { data: petData } = await supabase.from('pets').select('*').eq('id', route.params.petId).single()
  pet.value = petData

  // Restore calibration from Supabase if not in memory (e.g. page refresh)
  if (!hasCalibration()) {
    const { data: calData } = await supabase
      .from('pet_calibrations')
      .select('*')
      .eq('pet_id', route.params.petId)
      .not('E_base', 'is', null)
      .order('calibrated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (calData?.threshold != null) {
      setCalibration(calData.E_base, calData.P_peak, calData.threshold)
    }
  }

  checkCalibration()

  // Load last session
  const { data: sessions } = await supabase
    .from('guard_sessions')
    .select('*')
    .eq('pet_id', route.params.petId)
    .not('end_time', 'is', null)
    .order('end_time', { ascending: false })
    .limit(1)

  if (sessions?.length) {
    lastSession.value = sessions[0]
  }

  // Count unmarked snippets
  const { count } = await supabase
    .from('audio_snippets')
    .select('*', { count: 'exact', head: true })
    .eq('pet_id', route.params.petId)
    .is('label', null)

  unmarkedCount.value = count || 0
})

async function requestMicAndGo(mode) {
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true })
    if (mode === 'mark') {
      router.push(`/marking/${route.params.petId}`)
    } else {
      router.push(`/guarding/${route.params.petId}`)
    }
  } catch {
    alert('请允许麦克风权限以使用此功能')
  }
}

function formatSession(s) {
  if (!s) return ''
  const d = new Date(s.start_time)
  const date = d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
  const start = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  const end = s.end_time ? new Date(s.end_time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '...'
  return `${date} ${start}-${end}`
}
</script>

<template>
  <div class="min-h-screen bg-gradient-to-b from-amber-50 to-orange-50 flex flex-col">

    <!-- Header -->
    <div class="flex items-center justify-between p-4">
      <div class="flex items-center gap-2">
        <button @click="router.push('/pets')" class="text-amber-700 cursor-pointer">←</button>
        <span class="font-semibold text-amber-800">宠博士·云伴</span>
      </div>
      <button @click="router.push(`/settings/${pet?.id}`)"
        class="text-sm text-amber-600 hover:text-amber-700 cursor-pointer">设置</button>
    </div>

    <!-- Center Content -->
    <div class="flex-1 flex flex-col items-center px-4 pt-4 space-y-4">

      <!-- Pet Info -->
      <div class="text-center">
        <div class="text-5xl mb-2">{{ pet?.avatar || '🐕' }}</div>
        <p class="text-lg font-semibold text-amber-800">{{ pet?.name || '...' }}</p>
        <p class="text-xs text-gray-400">{{ pet?.breed || '' }}{{ pet?.body_size ? ' · ' + ({ small: '小型', medium: '中型', large: '大型' })[pet.body_size] : '' }}</p>
      </div>

      <!-- Calibration warning (only if not calibrated) -->
      <div v-if="needsCalibration" class="w-full max-w-sm bg-yellow-50 border border-yellow-200 rounded-2xl p-4">
        <p class="text-sm font-semibold text-yellow-700 mb-2">⚠️ 尚未校准</p>
        <p class="text-xs text-yellow-600 mb-3">建议先校准以获得更准确的检测效果。也可以跳过，系统会根据宠物体型自动设置。</p>
        <div class="flex gap-2">
          <button @click="router.push(`/calibrate/${route.params.petId}`)"
            class="flex-1 py-2 text-sm bg-amber-500 text-white rounded-xl hover:bg-amber-600 cursor-pointer">
            去校准
          </button>
          <button @click="skipCalibration"
            class="flex-1 py-2 text-sm border border-yellow-300 text-yellow-600 rounded-xl hover:bg-yellow-100 cursor-pointer">
            跳过，直接使用
          </button>
        </div>
      </div>

      <!-- Guard Mode Card -->
      <button @click="requestMicAndGo('guard')"
        class="w-full max-w-sm bg-white/80 rounded-2xl p-4 text-left shadow-sm hover:shadow-md transition cursor-pointer border border-amber-100"
        :class="{ 'opacity-50': needsCalibration }">
        <div class="flex items-start gap-3">
          <span class="text-2xl">🛡️</span>
          <div class="flex-1">
            <p class="font-semibold text-amber-800">守护模式</p>
            <p class="text-xs text-gray-400 mt-0.5">自动检测叫声并播放安抚语音</p>
            <p class="text-xs text-gray-300 mt-0.5">适合：上班/外出时使用</p>
          </div>
          <span class="text-amber-400 text-lg">→</span>
        </div>
      </button>

      <!-- Mark Mode Card -->
      <button @click="requestMicAndGo('mark')"
        class="w-full max-w-sm bg-white/80 rounded-2xl p-4 text-left shadow-sm hover:shadow-md transition cursor-pointer border border-indigo-100"
        :class="{ 'opacity-50': needsCalibration }">
        <div class="flex items-start gap-3">
          <span class="text-2xl">🎙️</span>
          <div class="flex-1">
            <p class="font-semibold text-indigo-700">标记模式</p>
            <p class="text-xs text-gray-400 mt-0.5">只记录异常声音，不播放安抚</p>
            <p class="text-xs text-gray-300 mt-0.5">适合：在家调试阈值时使用</p>
          </div>
          <span class="text-indigo-400 text-lg">→</span>
        </div>
      </button>

      <!-- Last Session Summary -->
      <div v-if="lastSession" class="w-full max-w-sm bg-white/50 rounded-xl p-3 text-xs text-gray-500">
        <p>📊 上次{{ lastSession.mode === 'mark' ? '标记' : '守护' }}：{{ formatSession(lastSession) }}</p>
        <p class="mt-0.5">焦虑 {{ lastSession.total_anxiety_count }} 次</p>
      </div>

      <!-- Unmarked snippets reminder -->
      <div v-if="unmarkedCount > 0" class="w-full max-w-sm">
        <button @click="router.push(`/audio-log/${pet?.id}`)"
          class="w-full bg-amber-100 rounded-xl p-3 text-left hover:bg-amber-200 transition cursor-pointer">
          <p class="text-sm text-amber-700">🔊 声音日志：{{ unmarkedCount }} 条未标记</p>
          <p class="text-xs text-amber-500 mt-0.5">去处理 →</p>
        </button>
      </div>

    </div>

    <!-- Recalibration entry + Bottom nav -->
    <div class="p-3 space-y-2">
      <button @click="router.push(`/calibrate/${pet?.id}`)"
        class="w-full text-center text-xs text-gray-400 hover:text-amber-600 cursor-pointer py-1">
        重新校准
      </button>

      <div class="flex justify-center gap-4 pb-2">
        <button @click="router.push(`/voices/${pet?.id}`)" class="text-sm text-gray-500 hover:text-amber-600 cursor-pointer">🎵 语音管理</button>
        <button @click="router.push(`/insights/${pet?.id}`)" class="text-sm text-gray-500 hover:text-amber-600 cursor-pointer">📈 情绪趋势</button>
        <button @click="router.push(`/audio-log/${pet?.id}`)" class="text-sm text-gray-500 hover:text-amber-600 cursor-pointer">📋 声音日志</button>
      </div>
    </div>

    <!-- Debug -->
    <div class="px-4 pb-2">
      <button @click="showDebug = !showDebug" class="text-xs text-gray-300 cursor-pointer w-full text-center">
        {{ showDebug ? '收起 ▲' : '调试 ▼' }}
      </button>
      <div v-if="showDebug" class="bg-white/80 rounded-xl p-3 text-xs text-gray-500 space-y-1 mt-1">
        <div>状态：待机中</div>
        <div>校准状态：{{ hasCalibration() ? '已校准' : '未校准' }}</div>
        <div>未标记录音：{{ unmarkedCount }} 条</div>
      </div>
    </div>

  </div>
</template>
