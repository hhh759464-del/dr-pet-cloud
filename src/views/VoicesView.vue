<script setup>
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { supabase } from '../lib/supabase'

const router = useRouter()
const route = useRoute()

const voices = ref([])
const recording = ref(false)
const recordingName = ref('')
const mediaRecorder = ref(null)
const audioChunks = ref([])
const recordingTime = ref(0)
let timer = null

onMounted(loadVoices)

async function loadVoices() {
  const { data } = await supabase.from('soothing_voices').select('*').eq('pet_id', route.params.petId).order('created_at', { ascending: false })
  voices.value = data || []
}

async function startRecording() {
  audioChunks.value = []
  recordingTime.value = 0
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  mediaRecorder.value = new MediaRecorder(stream)
  mediaRecorder.value.ondataavailable = (e) => audioChunks.value.push(e.data)
  mediaRecorder.value.onstop = async () => {
    const blob = new Blob(audioChunks.value, { type: 'audio/webm' })
    const fileName = `${Date.now()}.webm`
    const { data } = await supabase.storage.from('soothing-voices').upload(fileName, blob)
    if (data) {
      const url = supabase.storage.from('soothing-voices').getPublicUrl(fileName).data.publicUrl
      await supabase.from('soothing_voices').insert({
        pet_id: route.params.petId,
        name: recordingName.value || `语音 ${voices.value.length + 1}`,
        audio_url: url,
        duration_sec: recordingTime.value,
      })
      recordingName.value = ''
      loadVoices()
    }
    stream.getTracks().forEach(t => t.stop())
  }
  mediaRecorder.value.start()
  recording.value = true
  timer = setInterval(() => { recordingTime.value++ }, 1000)
}

function stopRecording() {
  mediaRecorder.value?.stop()
  recording.value = false
  clearInterval(timer)
  timer = null
}

async function deleteVoice(voice) {
  // Extract file path from storage URL and delete the file
  const url = voice.audio_url
  const pathMatch = url?.match(/soothing-voices\/(.+?)(\?|$)/)
  if (pathMatch) {
    await supabase.storage.from('soothing-voices').remove([pathMatch[1]])
  }
  await supabase.from('soothing_voices').delete().eq('id', voice.id)
  loadVoices()
}

function playVoice(url) {
  new Audio(url).play()
}
</script>

<template>
  <div class="min-h-screen bg-gradient-to-b from-amber-50 to-orange-50 p-4">
    <div class="max-w-lg mx-auto">
      <!-- Header -->
      <div class="flex items-center gap-3 mb-6">
        <button @click="router.back()" class="text-amber-700 text-lg cursor-pointer">←</button>
        <h1 class="text-xl font-bold text-amber-800">🎵 安抚语音管理</h1>
      </div>

      <!-- Record Section -->
      <div class="bg-white rounded-2xl p-5 shadow-sm mb-4">
        <h3 class="font-semibold text-gray-800 mb-3">{{ recording ? '正在录音...' : '录制新语音' }}</h3>

        <div v-if="recording" class="space-y-3">
          <div class="flex items-center gap-2">
            <span class="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
            <span class="text-red-500 font-medium">录音中 {{ recordingTime }}s</span>
          </div>
          <button @click="stopRecording"
            class="w-full py-2.5 bg-red-500 hover:bg-red-600 text-white font-medium rounded-xl transition cursor-pointer">
            停止录音
          </button>
        </div>

        <div v-else class="space-y-3">
          <input v-model="recordingName" placeholder="给这段语音起个名字（选填）"
            class="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-400 text-sm" />
          <button @click="startRecording"
            class="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-medium rounded-xl transition cursor-pointer">
            🎤 开始录音
          </button>
        </div>
      </div>

      <!-- Voice List -->
      <div class="space-y-2">
        <div v-for="voice in voices" :key="voice.id"
          class="bg-white rounded-xl p-4 shadow-sm flex items-center gap-3">
          <span class="text-2xl">🎵</span>
          <div class="flex-1">
            <p class="font-medium text-gray-800 text-sm">{{ voice.name }}</p>
            <p class="text-xs text-gray-400">{{ voice.duration_sec }}s</p>
          </div>
          <button @click="playVoice(voice.audio_url)" class="text-amber-500 hover:text-amber-600 cursor-pointer">▶ 试听</button>
          <button @click="deleteVoice(voice)" class="text-red-400 hover:text-red-600 text-sm cursor-pointer">删除</button>
        </div>

        <div v-if="voices.length === 0" class="text-center py-8 text-gray-400">
          <p class="text-3xl mb-2">🎙️</p>
          <p class="text-sm">还没有录制安抚语音</p>
          <p class="text-xs">录制你的声音，在宠物焦虑时自动播放</p>
        </div>
      </div>
    </div>
  </div>
</template>
