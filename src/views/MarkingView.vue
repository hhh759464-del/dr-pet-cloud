<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { supabase } from '../lib/supabase'
import { useAudio } from '../composables/useAudio'
import Waveform from '../components/Waveform.vue'

const router = useRouter()
const route = useRoute()

const {
  state, isListening, currentDb, frequencyData, timeData,
  startListening, stopListening, setOnTrigger, setOnStateChange,
  captureSnippet, setMarkingContext, getMarkingContext,
  hasCalibration, startCooldown, getCooldownRemaining,
  getThreshold, getEBase, setCalibration,
} = useAudio()

const pet = ref(null)
const sessionId = ref(null)
const snippets = ref([])
const lastSnippet = ref(null)
const cooldownRemaining = ref(0)
let cooldownTimer = null

onMounted(async () => {
  const { data: petData } = await supabase.from('pets').select('*').eq('id', route.params.petId).single()
  pet.value = petData

  // Restore calibration from Supabase if not in memory
  if (!hasCalibration()) {
    const { data: calData } = await supabase
      .from('pet_calibrations')
      .select('*')
      .eq('pet_id', route.params.petId)
      .order('calibrated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (calData?.threshold != null) {
      setCalibration(calData.E_base, calData.P_peak, calData.threshold)
    }
  }

  // Proceed even without calibration — useAudio will use body-size fallback

  // Try insert with mode column; fallback if DB not yet migrated
  let sessionData = null
  try {
    const res = await supabase.from('guard_sessions').insert({
      pet_id: route.params.petId,
      start_time: new Date().toISOString(),
      total_anxiety_count: 0,
      mode: 'mark',
    }).select().single()
    sessionData = res.data
  } catch {
    const res = await supabase.from('guard_sessions').insert({
      pet_id: route.params.petId,
      start_time: new Date().toISOString(),
      total_anxiety_count: 0,
    }).select().single()
    sessionData = res.data
  }
  sessionId.value = sessionData?.id
  setMarkingContext(route.params.petId, sessionId.value)

  setOnTrigger(handleTrigger)
  setOnStateChange(handleStateChange)

  await startListening('mark', petData?.body_size || 'medium')
})

onUnmounted(() => {
  stopListening()
  if (cooldownTimer) clearInterval(cooldownTimer)
})

async function handleTrigger(db, markingBuffer) {
  const blob = captureSnippet()
  if (!blob || !blob.size) return

  const now = new Date()
  const timestamp = now.toISOString().replace(/[:.]/g, '-')
  const fileName = `audio_snippets/${route.params.petId}/${timestamp}.webm`

  // Upload to Supabase Storage
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('audio_snippets')
    .upload(fileName, blob, { contentType: 'audio/webm' })

  if (uploadError) {
    console.warn('Failed to upload snippet:', uploadError.message)
    return
  }

  // Get public URL
  const { data: urlData } = supabase.storage.from('audio_snippets').getPublicUrl(fileName)

  // Insert record
  const { data: record } = await supabase.from('audio_snippets').insert({
    pet_id: route.params.petId,
    session_id: sessionId.value,
    peak_db: Math.round(db),
    audio_url: urlData?.publicUrl || '',
    recorded_at: now.toISOString(),
    label: null,
  }).select().single()

  if (record) {
    snippets.value.unshift(record)
    lastSnippet.value = record
  }
}

function handleStateChange(newState) {
  if (newState === 'cooldown') {
    cooldownRemaining.value = Math.ceil((60000) / 1000)
    cooldownTimer = setInterval(() => {
      cooldownRemaining.value = getCooldownRemaining()
      if (cooldownRemaining.value <= 0 && cooldownTimer) {
        clearInterval(cooldownTimer)
        cooldownTimer = null
      }
    }, 1000)
  }
}

async function stopMarking() {
  stopListening()
  if (cooldownTimer) clearInterval(cooldownTimer)

  if (sessionId.value) {
    await supabase.from('guard_sessions').update({
      end_time: new Date().toISOString(),
      total_anxiety_count: snippets.value.length,
    }).eq('id', sessionId.value)
  }

  // Navigate to summary or audio-log
  if (snippets.value.length > 0) {
    router.push(`/audio-log/${route.params.petId}`)
  } else {
    router.push(`/standby/${route.params.petId}`)
  }
}

const threshold = computed(() => getThreshold())
const eBase = computed(() => getEBase())
</script>

<template>
  <div class="min-h-screen bg-gradient-to-b from-blue-50 to-indigo-50 flex flex-col">

    <!-- Status Bar -->
    <div class="px-4 py-2 flex items-center justify-between">
      <span class="text-sm text-gray-500">标记模式 · {{ pet?.name || '...' }}</span>
      <span class="text-xs px-2 py-0.5 rounded-full"
        :class="{
          'bg-green-100 text-green-600': state === 'monitoring',
          'bg-red-100 text-red-600': state === 'triggered',
          'bg-yellow-100 text-yellow-600': state === 'cooldown',
        }">
        {{ state === 'monitoring' ? '监听中' : state === 'triggered' ? '记录中' : state === 'cooldown' ? '冷却中' : state }}
      </span>
    </div>

    <!-- Center Content -->
    <div class="flex-1 flex flex-col items-center justify-center px-4">
      <!-- State emoji -->
      <div class="text-8xl mb-4 transition-all duration-300"
        :class="{
          'animate-pulse': state === 'monitoring',
          'animate-bounce': state === 'triggered',
        }">
        {{ state === 'monitoring' ? '🎙️' : state === 'triggered' ? '🔴' : '⏳' }}
      </div>

      <p class="text-amber-600 font-medium mb-2 text-center">
        {{ state === 'monitoring' ? '正在记录异常声音...' : state === 'triggered' ? '检测到声音！正在录制...' : `冷却中… ${cooldownRemaining} 秒后恢复` }}
      </p>
      <p class="text-xs text-gray-400 mb-6 text-center max-w-xs">
        标记模式不会自动播放安抚语音，仅记录声音片段供你回家后回听标记
      </p>

      <!-- Snippet count -->
      <div class="bg-white/70 rounded-xl px-4 py-2 mb-4">
        <span class="text-sm text-gray-500">📊 本次已记录：</span>
        <span class="text-lg font-bold text-indigo-600">{{ snippets.length }} 段</span>
      </div>

      <!-- Last snippet info -->
      <div v-if="lastSnippet" class="text-xs text-gray-400 mb-4">
        上次记录：{{ new Date(lastSnippet.recorded_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }}
        &nbsp; {{ lastSnippet.peak_db }} dB
      </div>
    </div>

    <!-- Waveform & Controls -->
    <div class="p-4 space-y-4">
      <Waveform :time-data="timeData" :active="isListening" />

      <!-- Stop Button -->
      <button @click="stopMarking"
        class="w-full py-3 bg-indigo-500 hover:bg-indigo-600 text-white font-semibold rounded-2xl transition cursor-pointer">
        停止标记{{ snippets.length > 0 ? '并查看日志' : '' }}
      </button>
    </div>

    <!-- Bottom Nav -->
    <div class="flex justify-center gap-4 p-3 border-t border-indigo-200 bg-white/50">
      <button @click="router.push(`/voices/${pet?.id}`)" class="text-sm text-gray-500 hover:text-indigo-600 cursor-pointer">🎵 语音</button>
      <button @click="router.push(`/audio-log/${pet?.id}`)" class="text-sm text-gray-500 hover:text-indigo-600 cursor-pointer">📋 声音日志</button>
      <button @click="router.push(`/settings/${pet?.id}`)" class="text-sm text-gray-500 hover:text-indigo-600 cursor-pointer">⚙️ 设置</button>
    </div>

  </div>
</template>
