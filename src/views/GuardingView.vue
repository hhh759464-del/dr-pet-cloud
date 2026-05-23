<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { supabase } from '../lib/supabase'
import { useAudio } from '../composables/useAudio'
import { generateReportSummary } from '../lib/deepseek'
import Waveform from '../components/Waveform.vue'

const router = useRouter()
const route = useRoute()

const {
  state, isListening, currentDb, frequencyData, timeData,
  startListening, stopListening, setOnTrigger, setOnStateChange,
  hasCalibration, startCooldown, getCooldownRemaining,
  getThreshold, getEBase, disconnectMic, reconnectMic,
  setCalibration,
} = useAudio()

const pet = ref(null)
const sessionId = ref(null)
const sessionStart = ref(null)
const anxietyEvents = ref([])
const bannerVisible = ref(false)
const currentVoiceText = ref('')
const playingAudio = ref(null)
const cooldownRemaining = ref(0)
let cooldownTimer = null
let midnightTimer = null
let currentDay = ''

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

  const calibrated = hasCalibration()
  // If calibration exists, use it; otherwise body-size fallback will be used by useAudio

  const now = new Date()
  currentDay = now.toISOString().slice(0, 10)

  // Try insert with mode column; fallback if DB not yet migrated
  let sessionData = null
  try {
    const res = await supabase.from('guard_sessions').insert({
      pet_id: route.params.petId,
      start_time: now.toISOString(),
      total_anxiety_count: 0,
      mode: 'guard',
    }).select().single()
    sessionData = res.data
  } catch {
    const res = await supabase.from('guard_sessions').insert({
      pet_id: route.params.petId,
      start_time: now.toISOString(),
      total_anxiety_count: 0,
    }).select().single()
    sessionData = res.data
  }
  sessionId.value = sessionData?.id
  sessionStart.value = now

  setOnTrigger(handleAnxiety)
  setOnStateChange(handleStateChange)

  await startListening('guard')
  midnightTimer = setInterval(checkMidnight, 60000)
})

onUnmounted(() => {
  stopListening()
  if (midnightTimer) clearInterval(midnightTimer)
  if (cooldownTimer) clearInterval(cooldownTimer)
  if (playingAudio.value) {
    playingAudio.value.pause()
    playingAudio.value = null
  }
})

function handleStateChange(newState, prev) {
  if (newState === 'triggered') {
    bannerVisible.value = true
  }
  if (newState === 'cooldown') {
    cooldownRemaining.value = getCooldownRemaining()
    cooldownTimer = setInterval(() => {
      cooldownRemaining.value = getCooldownRemaining()
      if (cooldownRemaining.value <= 0 && cooldownTimer) {
        clearInterval(cooldownTimer)
        cooldownTimer = null
      }
    }, 1000)
  }
  if (prev === 'cooldown' && newState === 'monitoring') {
    bannerVisible.value = false
    cooldownRemaining.value = 0
  }
}

async function handleAnxiety(db) {
  const now = new Date()
  let voicePlayed = false
  let voiceId = null

  // Disconnect mic to prevent feedback from playing voice
  disconnectMic()

  voiceId = await playRandomVoice()
  voicePlayed = !!voiceId

  const event = { time: now, peakDb: currentDb.value, voicePlayed }
  anxietyEvents.value.push(event)

  if (sessionId.value) {
    await supabase.from('anxiety_events').insert({
      session_id: sessionId.value,
      triggered_at: now.toISOString(),
      duration_sec: 3,
      peak_db: currentDb.value,
      voice_played_id: voiceId || null,
    })
    await supabase.from('guard_sessions').update({
      total_anxiety_count: anxietyEvents.value.length,
    }).eq('id', sessionId.value)
  }

  // After voice playback, enter cooldown
  startCooldown()
}

async function playRandomVoice() {
  const { data: voices } = await supabase.from('soothing_voices').select('*').eq('pet_id', route.params.petId)

  if (voices?.length) {
    const voice = voices[Math.floor(Math.random() * voices.length)]
    currentVoiceText.value = voice.name || '播放安抚语音...'
    const audio = new Audio(voice.audio_url)
    playingAudio.value = audio
    try {
      await audio.play()
      return voice.id
    } catch {
      playTone()
      return null
    }
  } else {
    currentVoiceText.value = '（未录制安抚语音，播放默认提示音）'
    playTone()
    return null
  }
}

function playTone() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(440, ctx.currentTime)
    osc.frequency.setValueAtTime(554, ctx.currentTime + 0.3)
    osc.frequency.setValueAtTime(440, ctx.currentTime + 0.6)
    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1)
    osc.start()
    osc.stop(ctx.currentTime + 1)
  } catch { /* ignore */ }
}

async function getVsYesterday(todayDate, todayCount) {
  const d = new Date(todayDate)
  d.setDate(d.getDate() - 1)
  const yesterdayStr = d.toISOString().slice(0, 10)
  const { data } = await supabase
    .from('daily_reports')
    .select('stats_json')
    .eq('pet_id', pet.value.id)
    .eq('date', yesterdayStr)
    .maybeSingle()
  if (!data?.stats_json) return '昨天没有守护记录，明天就有对比数据啦'
  const yesterdayCount = data.stats_json.anxietyCount || 0
  if (todayCount === yesterdayCount) return '和昨天持平，情绪稳定～'
  if (todayCount < yesterdayCount) return `比昨天减少了 ${yesterdayCount - todayCount} 次焦虑，宝宝在进步！`
  return `比昨天增加了 ${todayCount - yesterdayCount} 次焦虑，可能今天状态不太好，明天继续观察～`
}

async function checkMidnight() {
  const today = new Date().toISOString().slice(0, 10)
  if (today !== currentDay) {
    const yesterday = currentDay
    currentDay = today

    const yesterdayEvents = anxietyEvents.value.filter(e =>
      new Date(e.time).toISOString().slice(0, 10) === yesterday
    )
    const todayEvents = anxietyEvents.value.filter(e =>
      new Date(e.time).toISOString().slice(0, 10) === today
    )
    anxietyEvents.value = todayEvents

    const st = buildStats(yesterday, yesterdayEvents)
    st.vsYesterday = await getVsYesterday(yesterday, st.anxietyCount)
    const summary = await generateReportSummary({ ...st, vsYesterday: st.vsYesterday || '暂无昨日数据对比' })
    await saveReport(pet.value.id, yesterday, summary, st)
  }
}

function buildStats(date, events) {
  const peak = events.reduce((max, e) => e.peakDb > max ? e.peakDb : max, 0) || 0
  const peakEvent = events.find(e => e.peakDb === peak)
  return {
    petName: pet.value?.name || '未知',
    date,
    durationMinutes: 0,
    anxietyCount: events.length,
    peakDb: peak,
    peakTime: peakEvent ? new Date(peakEvent.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : 'N/A',
    sootheRate: events.length > 0 ? Math.round((events.filter(e => e.voicePlayed).length / events.length) * 100) : 100,
    vsYesterday: '',
  }
}

async function saveReport(petId, date, text, st) {
  const { data: existing } = await supabase
    .from('daily_reports')
    .select('id, stats_json')
    .eq('pet_id', petId)
    .eq('date', date)
    .maybeSingle()

  if (existing) {
    const old = existing.stats_json || {}
    const merged = {
      durationMinutes: (old.durationMinutes || 0) + st.durationMinutes,
      anxietyCount: (old.anxietyCount || 0) + st.anxietyCount,
      peakDb: Math.max(old.peakDb || 0, st.peakDb),
      peakTime: (st.peakDb >= (old.peakDb || 0)) ? st.peakTime : old.peakTime,
      sootheRate: st.sootheRate,
    }
    await supabase.from('daily_reports').update({ summary_text: text, stats_json: merged }).eq('id', existing.id)
  } else {
    await supabase.from('daily_reports').insert({
      pet_id: petId,
      date,
      summary_text: text,
      stats_json: { durationMinutes: st.durationMinutes, anxietyCount: st.anxietyCount, peakDb: st.peakDb, peakTime: st.peakTime, sootheRate: st.sootheRate },
    })
  }
}

async function stopGuarding() {
  stopListening()
  if (midnightTimer) clearInterval(midnightTimer)
  if (cooldownTimer) clearInterval(cooldownTimer)

  if (sessionId.value) {
    await supabase.from('guard_sessions').update({
      end_time: new Date().toISOString(),
    }).eq('id', sessionId.value)
  }

  router.push(`/report/${sessionId.value}`)
}

// State-dependent UI
const emoji = computed(() => {
  if (state.value === 'triggered') return '😱'
  if (state.value === 'cooldown') return '😌'
  return '😴'
})

const statusText = computed(() => {
  if (state.value === 'triggered') return '检测到焦虑！正在播放安抚语音...'
  if (state.value === 'cooldown') return `冷却中… ${cooldownRemaining.value} 秒后恢复监听`
  return '正在监听中...'
})

const threshold = computed(() => getThreshold())
</script>

<template>
  <div class="min-h-screen bg-gradient-to-b from-amber-50 to-orange-50 flex flex-col">

    <!-- Alert Banner (triggered state) -->
    <div v-if="state === 'triggered'"
      class="bg-red-500 text-white px-4 py-3 flex items-center gap-2 animate-pulse">
      <span class="text-xl">⚠️</span>
      <span class="font-semibold">检测到叫声！正在播放安抚语音</span>
    </div>

    <!-- Cooldown Banner -->
    <div v-if="state === 'cooldown'"
      class="bg-yellow-500 text-white px-4 py-3 flex items-center gap-2">
      <span class="text-xl">🟡</span>
      <span class="font-semibold">冷却中… {{ cooldownRemaining }} 秒后恢复监听</span>
    </div>

    <!-- Status Bar -->
    <div class="px-4 py-2 flex items-center justify-between">
      <span class="text-sm text-gray-500">守护中 · {{ pet?.name || '...' }}</span>
      <span class="text-xs px-2 py-0.5 rounded-full"
        :class="{
          'bg-green-100 text-green-600': state === 'monitoring',
          'bg-red-100 text-red-600': state === 'triggered',
          'bg-yellow-100 text-yellow-600': state === 'cooldown',
        }">
        {{ state === 'monitoring' ? '监听中' : state === 'triggered' ? '触发' : '冷却' }}
      </span>
    </div>

    <!-- Center Content -->
    <div class="flex-1 flex flex-col items-center justify-center px-4">
      <!-- Emoji -->
      <div class="text-8xl mb-4 transition-all duration-300"
        :class="{
          'animate-pulse': state === 'monitoring',
          'animate-bounce': state === 'triggered',
        }">
        {{ emoji }}
      </div>

      <!-- Status Text -->
      <p class="text-amber-600 font-medium mb-2 text-center">{{ statusText }}</p>

      <!-- Current Voice -->
      <p v-if="currentVoiceText" class="text-sm text-amber-500 mb-4 text-center max-w-xs">
        {{ currentVoiceText }}
      </p>

      <!-- Monitoring Indicator -->
      <div v-if="state === 'monitoring'" class="flex items-center gap-2 mb-8">
        <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
        <span class="text-xs text-gray-500 tracking-wider">MONITORING</span>
      </div>

      <!-- Cooldown progress -->
      <div v-if="state === 'cooldown'" class="w-40 bg-gray-200 rounded-full h-2 mb-8">
        <div class="bg-yellow-500 h-2 rounded-full transition-all duration-1000"
          :style="{ width: ((60 - cooldownRemaining) / 60 * 100) + '%' }" />
      </div>

      <!-- Current dB -->
      <p class="text-xs text-gray-400 mt-4">
        当前: {{ currentDb }} dB / 阈值: {{ threshold }} dB
      </p>
    </div>

    <!-- Waveform & Controls -->
    <div class="p-4 space-y-4">
      <Waveform :time-data="timeData" :active="isListening" />

      <button @click="stopGuarding"
        :disabled="state === 'triggered'"
        class="w-full py-3 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-2xl transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
        停止守护并生成日报
      </button>
    </div>

  </div>
</template>
