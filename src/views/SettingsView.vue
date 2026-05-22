<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

const threshold = ref(75)
const triggerDelay = ref(2)
const cooldown = ref(60)

function save() {
  localStorage.setItem('settings', JSON.stringify({
    threshold: threshold.value,
    triggerDelay: triggerDelay.value,
    cooldown: cooldown.value,
  }))
  router.back()
}

// Load saved
const saved = JSON.parse(localStorage.getItem('settings') || '{}')
if (saved.threshold) threshold.value = saved.threshold
if (saved.triggerDelay) triggerDelay.value = saved.triggerDelay
if (saved.cooldown) cooldown.value = saved.cooldown
</script>

<template>
  <div class="min-h-screen bg-gradient-to-b from-amber-50 to-orange-50 p-4">
    <div class="max-w-lg mx-auto">
      <!-- Header -->
      <div class="flex items-center gap-3 mb-6">
        <button @click="router.back()" class="text-amber-700 text-lg cursor-pointer">←</button>
        <h1 class="text-xl font-bold text-amber-800">⚙️ 守护设置</h1>
      </div>

      <div class="bg-white rounded-2xl p-5 shadow-sm space-y-6">
        <!-- Threshold -->
        <div>
          <div class="flex justify-between mb-2">
            <label class="text-sm font-medium text-gray-700">分贝阈值</label>
            <span class="text-sm text-amber-600 font-semibold">{{ threshold }} dB</span>
          </div>
          <input v-model.number="threshold" type="range" min="40" max="100"
            class="w-full accent-amber-500" />
          <p class="text-xs text-gray-400 mt-1">环境音约 40-50dB，狗叫约 70-90dB</p>
        </div>

        <!-- Trigger Delay -->
        <div>
          <div class="flex justify-between mb-2">
            <label class="text-sm font-medium text-gray-700">触发延迟</label>
            <span class="text-sm text-amber-600 font-semibold">{{ triggerDelay }} 秒</span>
          </div>
          <input v-model.number="triggerDelay" type="range" min="1" max="5" step="0.5"
            class="w-full accent-amber-500" />
          <p class="text-xs text-gray-400 mt-1">持续超过阈值多久后才触发安抚</p>
        </div>

        <!-- Cooldown -->
        <div>
          <div class="flex justify-between mb-2">
            <label class="text-sm font-medium text-gray-700">冷却时间</label>
            <span class="text-sm text-amber-600 font-semibold">{{ cooldown }} 秒</span>
          </div>
          <input v-model.number="cooldown" type="range" min="30" max="300" step="10"
            class="w-full accent-amber-500" />
          <p class="text-xs text-gray-400 mt-1">两次安抚之间的最小间隔</p>
        </div>
      </div>

      <!-- Save -->
      <button @click="save"
        class="w-full mt-4 py-3 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-2xl transition cursor-pointer">
        保存设置
      </button>
    </div>
  </div>
</template>
