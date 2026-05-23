<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { supabase } from '../lib/supabase'
import { useAudio } from '../composables/useAudio'

const router = useRouter()
const route = useRoute()

const {
  calibrationProgress, currentDb,
  E_base, P_peak,
  calibrate, calibrateStep2, applyCalibration,
  getThreshold, getCalibration, stopListening,
  adjustThreshold: adjustAudioThreshold,
} = useAudio()

const pet = ref(null)
const pageStep = ref('intro') // intro | step1 | step2_choice | step2 | done
const errorMsg = ref('')
const calibrationResult = ref(null)

onMounted(async () => {
  const { data } = await supabase.from('pets').select('*').eq('id', route.params.petId).single()
  pet.value = data
})

onUnmounted(() => {
  stopListening()
})

async function startStep1() {
  errorMsg.value = ''
  pageStep.value = 'step1'
  try {
    await calibrate(pet.value?.id, supabase, pet.value?.body_size || 'medium')
    pageStep.value = 'step2_choice'
  } catch (err) {
    errorMsg.value = err.message || '校准失败，请重试'
    pageStep.value = 'intro'
  }
}

async function startStep2() {
  errorMsg.value = ''
  pageStep.value = 'step2'
  try {
    await calibrateStep2()
    finishCalibration()
  } catch (err) {
    errorMsg.value = '叫声采样失败，已使用默认值'
    finishCalibration()
  }
}

function skipStep2() {
  finishCalibration()
}

function finishCalibration() {
  const result = applyCalibration(pet.value?.body_size || 'medium')
  calibrationResult.value = { ...result }
  pageStep.value = 'done'
  saveCalibration()
}

function doAdjust(delta) {
  adjustAudioThreshold(delta)
  calibrationResult.value = {
    ...calibrationResult.value,
    threshold: getThreshold(),
  }
}

async function saveCalibration(source) {
  const { E_base: e, P_peak: p } = getCalibration()
  const t = getThreshold()
  const { error } = await supabase.from('pet_calibrations').insert({
    pet_id: pet.value?.id,
    E_base: e,
    P_peak: p,
    threshold: t,
    body_size: pet.value?.body_size || 'medium',
    source: source || calibrationResult.value?.source || 'calibration',
    calibrated_at: new Date().toISOString(),
  })
  if (error) console.warn('Failed to save calibration:', error.message)
}

function goToGuard() {
  const mode = route.query.mode || 'guard'
  router.push(`/${mode === 'mark' ? 'marking' : 'guarding'}/${route.params.petId}`)
}
</script>

<template>
  <div class="min-h-screen bg-gradient-to-b from-amber-50 to-orange-50 flex flex-col">

    <!-- Intro Step -->
    <div v-if="pageStep === 'intro'" class="flex-1 flex flex-col items-center justify-center px-6">
      <div class="text-7xl mb-6">🎤</div>
      <h1 class="text-xl font-bold text-amber-800 mb-3">首次使用需要校准</h1>
      <p class="text-sm text-amber-600 text-center max-w-xs mb-2">
        我们会先检测{{ pet?.name || '宠物' }}所处的环境噪音基线
      </p>
      <p class="text-xs text-gray-400 text-center max-w-xs mb-8">
        然后（可选）采集宠物的叫声样本，自动计算一个合理的触发阈值
      </p>

      <div class="bg-white/70 rounded-xl p-4 text-xs text-gray-500 space-y-2 mb-8 max-w-xs">
        <p><span class="font-semibold text-amber-600">第一步</span> — 保持房间安静 10 秒，检测环境底噪</p>
        <p><span class="font-semibold text-amber-600">第二步</span> — 让宠物叫几声（可跳过），采集叫声样本</p>
        <p><span class="font-semibold text-amber-600">完成</span> — 自动计算阈值，开始守护</p>
      </div>

      <p v-if="errorMsg" class="text-red-500 text-sm mb-4">{{ errorMsg }}</p>

      <button @click="startStep1"
        class="px-10 py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-2xl shadow-lg transition cursor-pointer">
        开始校准
      </button>
      <button @click="router.back()"
        class="mt-3 text-sm text-gray-400 hover:text-gray-600 cursor-pointer">返回</button>
    </div>

    <!-- Step 1: Environment Baseline -->
    <div v-else-if="pageStep === 'step1'" class="flex-1 flex flex-col items-center justify-center px-6">
      <div class="text-7xl mb-6 animate-pulse">🎤</div>
      <h2 class="text-lg font-bold text-amber-800 mb-2">正在检测环境底噪...</h2>
      <p class="text-sm text-amber-600 mb-8">请保持房间安静</p>

      <div class="w-full max-w-xs bg-amber-100 rounded-full h-3 mb-3">
        <div class="bg-amber-500 h-3 rounded-full transition-all duration-200"
          :style="{ width: calibrationProgress + '%' }" />
      </div>
      <p class="text-xs text-gray-400 mb-8">{{ Math.ceil(calibrationProgress * 0.1) }} / 10 秒</p>

      <p class="text-sm text-amber-700 mb-4">当前：{{ currentDb }} dB</p>

      <p class="text-xs text-gray-400 text-center max-w-xs">
        提示：正常的环境声音（窗外的车流声、空调声）都会被计入基线。
        请按宠物平时独处时的环境来设置（关窗/开窗、开空调等）。
      </p>
    </div>

    <!-- Step 2 Choice -->
    <div v-else-if="pageStep === 'step2_choice'" class="flex-1 flex flex-col items-center justify-center px-6">
      <div class="text-7xl mb-6">🐕</div>
      <h2 class="text-lg font-bold text-amber-800 mb-2">环境基线检测完成</h2>
      <p class="text-sm text-amber-600 mb-8 text-center max-w-xs">
        接下来可以采集{{ pet?.name || '宠物' }}的叫声样本，让阈值更精准
      </p>

      <button @click="startStep2"
        class="px-10 py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-2xl shadow-lg transition cursor-pointer mb-3">
        开始采样（15 秒）
      </button>
      <button @click="skipStep2"
        class="text-sm text-gray-400 hover:text-gray-600 cursor-pointer">
        跳过这一步，用默认值
      </button>

      <p class="text-xs text-gray-400 text-center max-w-xs mt-6">
        提示：如果宠物暂时不叫，可以跳过。系统会根据{{ pet?.name || '宠物' }}的体型自动设定一个合理的默认值。
      </p>
    </div>

    <!-- Step 2: Pet Vocalization -->
    <div v-else-if="pageStep === 'step2'" class="flex-1 flex flex-col items-center justify-center px-6">
      <div class="text-7xl mb-6 animate-pulse">🐕</div>
      <h2 class="text-lg font-bold text-amber-800 mb-2">正在采集叫声样本...</h2>
      <p class="text-sm text-amber-600 mb-8">请让{{ pet?.name || '宠物' }}发出叫声（或播放一段宠物叫的视频）</p>

      <div class="w-full max-w-xs bg-amber-100 rounded-full h-3 mb-3">
        <div class="bg-amber-500 h-3 rounded-full transition-all duration-200"
          :style="{ width: calibrationProgress + '%' }" />
      </div>
      <p class="text-xs text-gray-400 mb-8">{{ Math.ceil(calibrationProgress * 0.15) }} / 15 秒</p>

      <p class="text-sm text-amber-700 mb-4">当前：{{ currentDb }} dB</p>
    </div>

    <!-- Done -->
    <div v-else-if="pageStep === 'done'" class="flex-1 flex flex-col items-center justify-center px-6">
      <div class="text-6xl mb-4">✅</div>
      <h2 class="text-lg font-bold text-amber-800 mb-6">校准完成！</h2>

      <div v-if="calibrationResult" class="bg-white/70 rounded-xl p-4 text-sm text-amber-700 space-y-2 mb-4 w-full max-w-xs">
        <div class="flex justify-between">
          <span>环境基线</span>
          <span class="font-semibold">{{ calibrationResult.E_base }} dB</span>
        </div>
        <div class="flex justify-between">
          <span>宠物叫声峰值</span>
          <span class="font-semibold">{{ calibrationResult.P_peak ?? '未采样' }} dB</span>
        </div>
        <div class="flex justify-between border-t border-amber-200 pt-2">
          <span>触发阈值</span>
          <span class="font-semibold text-amber-800 text-lg">{{ calibrationResult.threshold }} dB</span>
        </div>
        <p class="text-xs text-gray-400 mt-1">
          {{ calibrationResult.source === 'calibration' ? '基于双步校准计算' : '基于体型自动估算' }}
        </p>
      </div>

      <!-- Micro-adjust buttons -->
      <div class="flex gap-3 mb-8">
        <button @click="doAdjust(-2)"
          class="px-4 py-1.5 text-sm border border-amber-300 text-amber-600 rounded-xl hover:bg-amber-100 transition cursor-pointer">
          微调 -2
        </button>
        <button @click="doAdjust(2)"
          class="px-4 py-1.5 text-sm border border-amber-300 text-amber-600 rounded-xl hover:bg-amber-100 transition cursor-pointer">
          微调 +2
        </button>
        <button @click="doAdjust(-5)"
          class="px-4 py-1.5 text-sm border border-orange-300 text-orange-500 rounded-xl hover:bg-orange-100 transition cursor-pointer">
          -5
        </button>
        <button @click="doAdjust(5)"
          class="px-4 py-1.5 text-sm border border-orange-300 text-orange-500 rounded-xl hover:bg-orange-100 transition cursor-pointer">
          +5
        </button>
      </div>

      <p class="text-xs text-gray-400 text-center max-w-xs mb-8">
        如果之后误触发太多 → 微调 +2；如果宠物叫了没触发 → 微调 -2
      </p>

      <button @click="goToGuard"
        class="px-10 py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-2xl shadow-lg transition cursor-pointer mb-3">
        {{ route.query.mode === 'mark' ? '开始标记' : '开始守护' }}
      </button>
      <button @click="router.back()"
        class="text-sm text-gray-400 hover:text-gray-600 cursor-pointer">返回</button>
    </div>

  </div>
</template>
