<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { supabase } from '../lib/supabase'
import { useAudio } from '../composables/useAudio'

const router = useRouter()
const route = useRoute()
const { setCalibration } = useAudio()

const pet = ref(null)
const groupedSnippets = ref([]) // [{ date, snippets: [...] }]
const playingId = ref(null)
const audioEl = ref(null)
const loading = ref(true)

// Threshold suggestion
const suggestion = ref(null) // { suggested, dogMin, noiseMax }
const hasAppliedSuggestion = ref(false)

onMounted(async () => {
  const { data: petData } = await supabase.from('pets').select('*').eq('id', route.params.petId).single()
  pet.value = petData
  await cleanupExpired()
  await loadSnippets()
  loading.value = false
})

async function cleanupExpired() {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 7)

  const { data: expired } = await supabase
    .from('audio_snippets')
    .select('id, audio_url')
    .eq('pet_id', route.params.petId)
    .is('label', null)
    .lt('recorded_at', cutoff.toISOString())

  if (expired?.length) {
    // Delete from Storage
    for (const item of expired) {
      const path = item.audio_url?.split('/').slice(-2).join('/')
      if (path) {
        await supabase.storage.from('audio_snippets').remove([path])
      }
    }
    // Delete from DB
    await supabase.from('audio_snippets').delete().in('id', expired.map(e => e.id))
  }
}

async function loadSnippets() {
  const { data } = await supabase
    .from('audio_snippets')
    .select('*')
    .eq('pet_id', route.params.petId)
    .order('recorded_at', { ascending: false })

  if (!data?.length) {
    groupedSnippets.value = []
    computeSuggestion()
    return
  }

  // Group by date
  const groups = {}
  for (const s of data) {
    const date = new Date(s.recorded_at).toLocaleDateString('zh-CN')
    if (!groups[date]) groups[date] = []
    groups[date].push(s)
  }

  groupedSnippets.value = Object.entries(groups).map(([date, snippets]) => ({ date, snippets }))
  computeSuggestion()
}

function computeSuggestion() {
  // Collect all labeled snippets from groupedSnippets
  const allSnippets = groupedSnippets.value.flatMap(g => g.snippets)
  const dogBarks = allSnippets.filter(s => s.label === true)
  const noises = allSnippets.filter(s => s.label === false)

  if (dogBarks.length === 0 || noises.length === 0) {
    suggestion.value = null
    return
  }

  const dogMin = Math.min(...dogBarks.map(s => s.peak_db))
  const noiseMax = Math.max(...noises.map(s => s.peak_db))

  let suggested = Math.round((dogMin + noiseMax) / 2)

  // If noise and bark overlap, set threshold above noise
  if (noiseMax >= dogMin) {
    suggested = Math.round(noiseMax + 2)
  }

  suggestion.value = { suggested, dogMin, noiseMax }
}

function playSnippet(snippet) {
  if (playingId.value === snippet.id) {
    audioEl.value?.pause()
    playingId.value = null
    return
  }

  if (audioEl.value) {
    audioEl.value.pause()
    audioEl.value = null
  }

  const audio = new Audio(snippet.audio_url)
  audio.onended = () => { playingId.value = null }
  audio.onerror = () => { playingId.value = null }
  audio.play()
  audioEl.value = audio
  playingId.value = snippet.id
}

async function labelSnippet(snippet, label) {
  const { error } = await supabase
    .from('audio_snippets')
    .update({ label })
    .eq('id', snippet.id)

  if (!error) {
    snippet.label = label
    computeSuggestion()
  }
}

function applySuggestion() {
  if (!suggestion.value) return
  const e = pet.value?.body_size ? null : null
  // Get current calibration E_base first
  // We just set the threshold — E_base and P_peak stay the same
  setCalibration(null, null, suggestion.value.suggested)

  supabase.from('pet_calibrations').insert({
    pet_id: route.params.petId,
    E_base: null,
    P_peak: null,
    threshold: suggestion.value.suggested,
    body_size: pet.value?.body_size || 'medium',
    source: 'manual_correction',
    calibrated_at: new Date().toISOString(),
  }).then(({ error }) => {
    if (error) console.warn('Failed to save suggestion:', error.message)
  })

  hasAppliedSuggestion.value = true
}

const showSuggestion = computed(() => {
  return suggestion.value && !hasAppliedSuggestion.value
})

function dbBarWidth(db) {
  return Math.min(100, Math.max(10, (db / 80) * 100))
}

function getLabelTag(snippet) {
  if (snippet.label === true) return { text: '是狗叫', cls: 'bg-green-100 text-green-600' }
  if (snippet.label === false) return { text: '不是', cls: 'bg-gray-100 text-gray-500' }
  return null
}
</script>

<template>
  <div class="min-h-screen bg-gradient-to-b from-amber-50 to-orange-50 flex flex-col">

    <!-- Header -->
    <div class="flex items-center justify-between p-4">
      <div class="flex items-center gap-2">
        <button @click="router.push('/pets')" class="text-amber-700 cursor-pointer">←</button>
        <span class="font-semibold text-amber-800">🔊 {{ pet?.name || '...' }} 声音日志</span>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 px-4 pb-4 overflow-auto">

      <!-- Loading -->
      <div v-if="loading" class="text-center py-12 text-gray-400">
        <p>加载中...</p>
      </div>

      <!-- Empty -->
      <div v-else-if="groupedSnippets.length === 0" class="text-center py-12">
        <div class="text-6xl mb-4">📭</div>
        <p class="text-gray-500">还没有录制的声音片段</p>
        <p class="text-xs text-gray-400 mt-2">开启标记模式后，检测到的声音会出现在这里</p>
        <button @click="router.push(`/standby/${route.params.petId}`)"
          class="mt-6 px-6 py-2 bg-amber-500 text-white rounded-xl text-sm cursor-pointer">
          去开启标记模式
        </button>
      </div>

      <!-- Snippet list grouped by date -->
      <div v-else>
        <div v-for="group in groupedSnippets" :key="group.date" class="mb-6">
          <h3 class="text-sm font-semibold text-amber-600 mb-3 sticky top-0 bg-gradient-to-b from-amber-50 to-orange-50 py-2">
            ── {{ group.date }} ──
          </h3>

          <div v-for="snippet in group.snippets" :key="snippet.id"
            class="bg-white/70 rounded-xl p-3 mb-3 space-y-2">

            <!-- Top row: time + dB bar -->
            <div class="flex items-center gap-3">
              <span class="text-xs text-gray-400 w-12">
                {{ new Date(snippet.recorded_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }}
              </span>

              <!-- dB bar -->
              <div class="flex-1 h-3 bg-amber-100 rounded-full overflow-hidden">
                <div class="h-full rounded-full transition-all"
                  :class="{
                    'bg-green-400': snippet.peak_db < 60,
                    'bg-yellow-400': snippet.peak_db >= 60 && snippet.peak_db < 75,
                    'bg-red-400': snippet.peak_db >= 75,
                  }"
                  :style="{ width: dbBarWidth(snippet.peak_db) + '%' }" />
              </div>

              <span class="text-sm font-semibold text-amber-700 w-12 text-right">{{ snippet.peak_db }} dB</span>
            </div>

            <!-- Bottom row: play + label buttons -->
            <div class="flex items-center gap-2">
              <button @click="playSnippet(snippet)"
                class="text-xs px-3 py-1 rounded-lg transition cursor-pointer"
                :class="playingId === snippet.id
                  ? 'bg-amber-500 text-white'
                  : 'bg-amber-100 text-amber-700 hover:bg-amber-200'">
                {{ playingId === snippet.id ? '⏸ 暂停' : '▶ 试听 (0:06)' }}
              </button>

              <!-- Label tag or action buttons -->
              <template v-if="getLabelTag(snippet)">
                <span class="text-xs px-2 py-1 rounded-full" :class="getLabelTag(snippet).cls">
                  {{ getLabelTag(snippet).text }}
                </span>
              </template>
              <template v-else>
                <div class="flex gap-1 ml-auto">
                  <button @click="labelSnippet(snippet, true)"
                    class="text-xs px-2 py-1 rounded-lg bg-green-100 text-green-600 hover:bg-green-200 cursor-pointer">
                    ✓ 是狗叫
                  </button>
                  <button @click="labelSnippet(snippet, false)"
                    class="text-xs px-2 py-1 rounded-lg bg-red-100 text-red-500 hover:bg-red-200 cursor-pointer">
                    ✗ 不是
                  </button>
                  <button @click="labelSnippet(snippet, null)"
                    class="text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-400 hover:bg-gray-200 cursor-pointer">
                    跳过
                  </button>
                </div>
              </template>
            </div>

            <!-- Expiry hint for unlabeled -->
            <p v-if="snippet.label === null" class="text-xs text-gray-300">
              未标记，6 天后自动删除
            </p>
          </div>
        </div>
      </div>

      <!-- Threshold Suggestion -->
      <div v-if="showSuggestion" class="bg-white/80 rounded-xl p-4 mt-4 border border-amber-200">
        <h4 class="text-sm font-semibold text-amber-800 mb-3">📊 阈值分析</h4>
        <div class="text-xs text-gray-500 space-y-1 mb-3">
          <p>标记了 {{ suggestion.dogMin ? '若干' : '0' }} 条"是狗叫" — 最低狗叫声：<span class="font-semibold text-amber-700">{{ suggestion.dogMin }} dB</span></p>
          <p>标记了 {{ suggestion.noiseMax ? '若干' : '0' }} 条"不是" — 最高噪音：<span class="font-semibold text-gray-600">{{ suggestion.noiseMax }} dB</span></p>
          <p class="pt-2">→ 建议阈值：<span class="font-bold text-amber-800 text-base">{{ suggestion.suggested }} dB</span></p>
          <p class="text-xs text-gray-300">（狗叫最低值 {{ suggestion.dogMin }} 和噪音最高值 {{ suggestion.noiseMax }} 的中点）</p>
        </div>
        <button @click="applySuggestion"
          class="w-full py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition cursor-pointer">
          一键应用建议阈值
        </button>
      </div>

      <!-- Applied confirmation -->
      <div v-if="hasAppliedSuggestion" class="text-center py-3">
        <p class="text-sm text-green-600">✅ 建议阈值已应用，下次守护时生效</p>
      </div>

    </div>

    <!-- Hidden audio element reference cleanup -->
    <div class="hidden"></div>
  </div>
</template>
