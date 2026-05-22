<script setup>
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { supabase } from '../lib/supabase'

const router = useRouter()
const route = useRoute()

const reports = ref([])
const petName = ref('')
const expandedId = ref(null)

onMounted(async () => {
  const petId = route.params.petId
  const { data: petData } = await supabase.from('pets').select('name').eq('id', petId).single()
  petName.value = petData?.name || ''

  const { data } = await supabase
    .from('daily_reports')
    .select('*')
    .eq('pet_id', petId)
    .order('date', { ascending: false })

  reports.value = (data || []).map(r => {
    const s = r.stats_json || {}
    return {
      id: r.id,
      date: r.date,
      summary: r.summary_text,
      durationMinutes: s.durationMinutes || 0,
      anxietyCount: s.anxietyCount || 0,
      peakDb: s.peakDb || 0,
      peakTime: s.peakTime || 'N/A',
      sootheRate: s.sootheRate || 100,
    }
  })
})

function toggleExpand(id) {
  expandedId.value = expandedId.value === id ? null : id
}

function getVsYesterdayText(index) {
  if (index >= reports.value.length - 1) return '暂无更早数据对比'
  const today = reports.value[index].anxietyCount
  const yesterday = reports.value[index + 1].anxietyCount
  if (today === yesterday) return '和前一天持平'
  if (today < yesterday) return `比前一天减少 ${yesterday - today} 次`
  return `比前一天增加 ${today - yesterday} 次`
}
</script>

<template>
  <div class="min-h-screen bg-gradient-to-b from-amber-50 to-orange-50 p-4">
    <div class="max-w-lg mx-auto">
      <div class="flex items-center gap-3 mb-6">
        <button @click="router.back()" class="text-amber-700 text-lg cursor-pointer">←</button>
        <h1 class="text-xl font-bold text-amber-800">{{ petName }} · 历史报告</h1>
      </div>

      <div v-if="reports.length === 0" class="text-center py-12 text-gray-400">
        <p class="text-4xl mb-3">📋</p>
        <p>暂无守护报告</p>
        <p class="text-sm mt-1">开启一次守护并结束后，报告会出现在这里</p>
      </div>

      <div class="space-y-3">
        <div v-for="(r, i) in reports" :key="r.id"
          class="bg-white rounded-2xl shadow-sm overflow-hidden">
          <!-- Header (always visible) -->
          <div @click="toggleExpand(r.id)"
            class="p-4 flex items-center gap-3 cursor-pointer hover:bg-amber-50/50 transition">
            <span class="text-xl">{{ r.anxietyCount > 0 ? '🐾' : '✅' }}</span>
            <div class="flex-1 min-w-0">
              <p class="font-medium text-gray-800 text-sm">{{ r.date }}</p>
              <p class="text-xs text-gray-400 truncate">{{ r.summary?.slice(0, 35) }}...</p>
            </div>
            <span class="text-gray-400 text-sm">{{ expandedId === r.id ? '▲' : '▼' }}</span>
          </div>

          <!-- Expanded Detail -->
          <div v-if="expandedId === r.id" class="px-4 pb-4 space-y-3 border-t border-amber-100 pt-4">
            <!-- AI Summary -->
            <div class="bg-amber-50 rounded-xl p-3">
              <p class="text-sm text-gray-700 leading-relaxed">{{ r.summary }}</p>
            </div>

            <!-- Stats Grid -->
            <div class="grid grid-cols-2 gap-2">
              <div class="bg-gray-50 rounded-xl p-3 text-center">
                <p class="text-lg font-bold text-amber-600">{{ r.durationMinutes }}</p>
                <p class="text-xs text-gray-500">守护时长(分钟)</p>
              </div>
              <div class="bg-gray-50 rounded-xl p-3 text-center">
                <p class="text-lg font-bold" :class="r.anxietyCount > 0 ? 'text-red-500' : 'text-green-500'">{{ r.anxietyCount }}</p>
                <p class="text-xs text-gray-500">焦虑事件次数</p>
              </div>
              <div class="bg-gray-50 rounded-xl p-3 text-center">
                <p class="text-lg font-bold text-amber-600">{{ r.peakDb }} dB</p>
                <p class="text-xs text-gray-500">峰值分贝</p>
              </div>
              <div class="bg-gray-50 rounded-xl p-3 text-center">
                <p class="text-lg font-bold text-green-500">{{ r.sootheRate }}%</p>
                <p class="text-xs text-gray-500">安抚介入率</p>
              </div>
            </div>

            <!-- vs Yesterday -->
            <div class="bg-white border border-gray-200 rounded-xl p-3 text-center">
              <p class="text-xs text-gray-500">对比前一天</p>
              <p class="text-sm font-medium text-gray-700">{{ getVsYesterdayText(i) }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
