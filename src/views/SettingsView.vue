<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { supabase } from '../lib/supabase'
import { useAudio } from '../composables/useAudio'

const router = useRouter()
const route = useRoute()

const {
  getThreshold, getEBase,
  adjustThreshold, setWindowMs, setCooldownMs,
  hasCalibration, setCalibration,
} = useAudio()

const pet = ref(null)
const lastCalibration = ref(null)
const windowMs = ref(5000)
const cooldownMs = ref(60000)

onMounted(async () => {
  const { data: petData } = await supabase.from('pets').select('*').eq('id', route.params.petId).single()
  pet.value = petData

  // Load latest calibration
  const { data: calData } = await supabase
    .from('pet_calibrations')
    .select('*')
    .eq('pet_id', route.params.petId)
    .order('calibrated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (calData) {
    lastCalibration.value = calData
    // Restore calibration to useAudio state
    setCalibration(calData.E_base, calData.P_peak, calData.threshold)
  }
})

const threshold = computed(() => getThreshold())
const eBase = computed(() => getEBase())
const thresholdDelta = computed(() => {
  if (!hasCalibration() || !eBase.value) return '--'
  const t = threshold.value
  const e = eBase.value
  return t != null && e != null ? `+${t - e} dB` : '--'
})

const lastCalDate = computed(() => {
  if (!lastCalibration.value) return '未校准'
  return new Date(lastCalibration.value.calibrated_at).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
})

const calSource = computed(() => {
  if (!lastCalibration.value) return ''
  const s = lastCalibration.value.source
  return s === 'calibration' ? '双步校准' : s === 'body_size_fallback' ? '体型估算' : s === 'manual_correction' ? '手动修正' : s
})

function doAdjust(delta) {
  adjustThreshold(delta)
}

function setWindow(ms) {
  windowMs.value = ms
  setWindowMs(ms)
}

function setCooldown(ms) {
  cooldownMs.value = ms
  setCooldownMs(ms)
}

async function useBodySizeFallback() {
  if (!pet.value?.body_size || !eBase.value) return
  const delta = { small: 10, medium: 15, large: 20 }[pet.value.body_size] || 15
  const t = eBase.value + delta
  setCalibration(eBase.value, null, t)

  await supabase.from('pet_calibrations').insert({
    pet_id: route.params.petId,
    E_base: eBase.value,
    P_peak: null,
    threshold: t,
    body_size: pet.value.body_size,
    source: 'body_size_fallback',
    calibrated_at: new Date().toISOString(),
  })

  lastCalibration.value = { ...lastCalibration.value, threshold: t, source: 'body_size_fallback', calibrated_at: new Date().toISOString() }
}

async function clearMarkedData() {
  if (!confirm('确定要清空该宠物的所有已标记声音数据吗？如果你换了新宠物，建议清空。')) return

  const { data: snippets } = await supabase
    .from('audio_snippets')
    .select('id, audio_url')
    .eq('pet_id', route.params.petId)
    .not('label', 'is', null)

  if (snippets?.length) {
    const paths = snippets.map(s => s.audio_url?.split('/').slice(-2).join('/')).filter(Boolean)
    if (paths.length) await supabase.storage.from('audio_snippets').remove(paths)
    await supabase.from('audio_snippets').delete().in('id', snippets.map(s => s.id))
  }

  alert('已清空')
}
</script>

<template>
  <div class="min-h-screen bg-gradient-to-b from-amber-50 to-orange-50 p-4">
    <div class="max-w-lg mx-auto">

      <!-- Header -->
      <div class="flex items-center gap-3 mb-6">
        <button @click="router.back()" class="text-amber-700 text-lg cursor-pointer">←</button>
        <h1 class="text-xl font-bold text-amber-800">⚙️ 设置</h1>
      </div>

      <div class="space-y-4">

        <!-- Threshold Micro-adjust -->
        <div class="bg-white rounded-2xl p-5 shadow-sm">
          <h3 class="text-sm font-semibold text-gray-700 mb-3">── 阈值微调 ──</h3>

          <div class="text-center mb-3">
            <p class="text-2xl font-bold text-amber-800">{{ threshold ?? '--' }} dB</p>
            <p class="text-xs text-gray-400">相对基线 {{ thresholdDelta }}</p>
            <p class="text-xs text-gray-300 mt-0.5">上次校准：{{ lastCalDate }}（{{ calSource }}）</p>
          </div>

          <div class="flex justify-center gap-2 mb-3">
            <button @click="doAdjust(-5)"
              class="px-3 py-2 text-sm border border-red-300 text-red-500 rounded-xl hover:bg-red-50 transition cursor-pointer">
              -5
            </button>
            <button @click="doAdjust(-2)"
              class="px-3 py-2 text-sm border border-orange-300 text-orange-500 rounded-xl hover:bg-orange-50 transition cursor-pointer">
              -2
            </button>
            <div class="px-3 py-2 text-sm bg-amber-100 text-amber-800 rounded-xl font-semibold">
              当前
            </div>
            <button @click="doAdjust(2)"
              class="px-3 py-2 text-sm border border-orange-300 text-orange-500 rounded-xl hover:bg-orange-50 transition cursor-pointer">
              +2
            </button>
            <button @click="doAdjust(5)"
              class="px-3 py-2 text-sm border border-red-300 text-red-500 rounded-xl hover:bg-red-50 transition cursor-pointer">
              +5
            </button>
          </div>

          <p class="text-xs text-gray-300 mt-2 text-center">更灵敏 ← → 更不灵敏</p>

          <div class="bg-amber-50 rounded-lg p-3 mt-3 text-xs text-gray-400 space-y-0.5">
            <p>如果你发现：</p>
            <p class="text-red-400">· 经常误触发（关门/车声也触发）→ 点 +2 或 +5</p>
            <p class="text-green-500">· 狗叫了没触发 → 点 -2 或 -5</p>
          </div>
        </div>

        <!-- Trigger Strategy -->
        <div class="bg-white rounded-2xl p-5 shadow-sm">
          <h3 class="text-sm font-semibold text-gray-700 mb-3">── 触发策略 ──</h3>

          <div class="mb-4">
            <label class="text-xs text-gray-500 mb-2 block">滑动窗口</label>
            <div class="flex gap-2">
              <button v-for="ms in [3000, 5000, 8000]" :key="ms"
                @click="setWindow(ms)"
                class="flex-1 py-2 text-sm rounded-xl transition cursor-pointer"
                :class="windowMs === ms
                  ? 'bg-amber-500 text-white'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'">
                {{ ms / 1000 }}秒{{ ms === 5000 ? '（推荐）' : ms === 3000 ? '（更灵敏）' : '（更保守）' }}
              </button>
            </div>
          </div>

          <div>
            <label class="text-xs text-gray-500 mb-2 block">冷却时间</label>
            <div class="flex gap-2">
              <button v-for="ms in [30000, 60000, 120000]" :key="ms"
                @click="setCooldown(ms)"
                class="flex-1 py-2 text-sm rounded-xl transition cursor-pointer"
                :class="cooldownMs === ms
                  ? 'bg-amber-500 text-white'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'">
                {{ ms / 1000 }}秒{{ ms === 60000 ? '（推荐）' : '' }}
              </button>
            </div>
          </div>
        </div>

        <!-- Calibration -->
        <div class="bg-white rounded-2xl p-5 shadow-sm">
          <h3 class="text-sm font-semibold text-gray-700 mb-3">── 校准 ──</h3>
          <div class="space-y-2">
            <button @click="router.push(`/calibrate/${route.params.petId}`)"
              class="w-full py-2 text-sm bg-amber-100 text-amber-700 rounded-xl hover:bg-amber-200 transition cursor-pointer">
              重新校准
            </button>
            <button @click="useBodySizeFallback"
              class="w-full py-2 text-sm bg-gray-100 text-gray-500 rounded-xl hover:bg-gray-200 transition cursor-pointer">
              使用体型默认值
            </button>
          </div>
        </div>

        <!-- Data Management -->
        <div class="bg-white rounded-2xl p-5 shadow-sm">
          <h3 class="text-sm font-semibold text-gray-700 mb-3">── 声音日志 ──</h3>
          <button @click="clearMarkedData"
            class="w-full py-2 text-sm bg-red-50 text-red-400 rounded-xl hover:bg-red-100 transition cursor-pointer">
            清空所有已标记数据
          </button>
          <p class="text-xs text-gray-300 mt-1 text-center">如果你换了新宠物，建议清空</p>
        </div>

      </div>

    </div>
  </div>
</template>
