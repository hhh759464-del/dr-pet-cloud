<script setup>
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { supabase } from '../lib/supabase'
import { useAuth } from '../composables/useAuth'
import Waveform from '../components/Waveform.vue'

const router = useRouter()
const route = useRoute()
const { user } = useAuth()

const pet = ref(null)
const showDebug = ref(false)
const micGranted = ref(false)
const flatData = new Uint8Array(128).fill(128)

onMounted(async () => {
  const { data } = await supabase.from('pets').select('*').eq('id', route.params.petId).single()
  pet.value = data
})

async function requestMic() {
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true })
    micGranted.value = true
    router.push(`/guarding/${route.params.petId}`)
  } catch {
    alert('请允许麦克风权限以开启守护功能')
  }
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
      <button @click="router.push(`/insights/${pet?.id}`)"
        class="text-sm text-amber-600 hover:text-amber-700 cursor-pointer">情绪记录</button>
    </div>

    <!-- Center Content -->
    <div class="flex-1 flex flex-col items-center justify-center px-4">
      <!-- Pet Name -->
      <p class="text-lg text-amber-700 mb-4" v-if="pet">{{ pet.name }} · 待机中</p>

      <!-- Emoji -->
      <div class="text-8xl mb-4 animate-pulse">😴</div>
      <p class="text-amber-500 text-lg font-medium mb-8 tracking-wider">READY TO GUARD</p>

      <!-- Start Button -->
      <button @click="requestMic"
        class="px-12 py-4 bg-amber-500 hover:bg-amber-600 text-white text-lg font-bold rounded-2xl shadow-lg hover:shadow-xl transition transform hover:scale-105 active:scale-95 cursor-pointer">
        开启守护
      </button>
    </div>

    <!-- Bottom Section -->
    <div class="p-4 space-y-2">
      <Waveform :time-data="flatData" :active="false" />

      <!-- Debug Panel -->
      <button @click="showDebug = !showDebug" class="text-xs text-gray-400 cursor-pointer w-full text-center">
        {{ showDebug ? '收起调试面板 ▲' : '调试面板 ▼' }}
      </button>
      <div v-if="showDebug" class="bg-white/80 rounded-xl p-3 text-xs text-gray-500 space-y-1">
        <div>状态：待机中</div>
        <div>分贝阈值：75dB</div>
        <div>麦克风：{{ micGranted ? '已授权' : '未授权' }}</div>
      </div>
    </div>

    <!-- Bottom Nav -->
    <div class="flex justify-center gap-4 p-3 border-t border-amber-200 bg-white/50">
      <button @click="router.push(`/voices/${pet?.id}`)" class="text-sm text-gray-500 hover:text-amber-600 cursor-pointer">🎵 语音</button>
      <button @click="router.push(`/reports/${pet?.id}`)" class="text-sm text-gray-500 hover:text-amber-600 cursor-pointer">📋 报告</button>
      <button @click="router.push(`/settings/${pet?.id}`)" class="text-sm text-gray-500 hover:text-amber-600 cursor-pointer">⚙️ 设置</button>
    </div>
  </div>
</template>
