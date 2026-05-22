<script setup>
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { supabase } from '../lib/supabase'

const router = useRouter()
const route = useRoute()

const now = new Date()
const currentMonth = ref(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
const calendarDays = ref([])
const monthStats = ref({ calm: 0, anxious: 0 })
const selectedReport = ref(null)
const reportMap = ref({})

onMounted(() => loadMonthData())

async function loadMonthData() {
  selectedReport.value = null
  const [year, month] = currentMonth.value.split('-').map(Number)
  const endDay = new Date(year, month, 0).getDate()
  const startDate = `${currentMonth.value}-01`
  const endDate = `${currentMonth.value}-${String(endDay).padStart(2, '0')}`

  const petId = route.params.petId

  // Primary: daily_reports
  const { data: reports } = await supabase
    .from('daily_reports')
    .select('*')
    .eq('pet_id', petId)
    .gte('date', startDate)
    .lte('date', endDate)

  const rMap = {}
  reports?.forEach(r => { rMap[r.date] = r })
  reportMap.value = rMap

  // Fallback: guard_sessions that overlap this month
  const { data: sessions } = await supabase
    .from('guard_sessions')
    .select('id, start_time, end_time, total_anxiety_count')
    .eq('pet_id', petId)
    .gte('start_time', `${startDate}T00:00:00`)
    .order('start_time', { ascending: false })
    .limit(200)

  const days = []
  let calm = 0, anxious = 0
  for (let d = 1; d <= endDay; d++) {
    const dateStr = `${currentMonth.value}-${String(d).padStart(2, '0')}`
    const report = rMap[dateStr]

    if (report) {
      const hasAnxiety = report.stats_json?.anxietyCount > 0
      hasAnxiety ? anxious++ : calm++
      days.push({ date: dateStr, day: d, hasAnxiety, hasData: true, fromReport: true })
    } else {
      const dayStart = new Date(`${dateStr}T00:00:00`)
      const dayEnd = new Date(`${dateStr}T23:59:59`)
      const daySessions = sessions?.filter(s => {
        const start = new Date(s.start_time)
        const end = s.end_time ? new Date(s.end_time) : new Date()
        return start <= dayEnd && end >= dayStart
      }) || []

      if (daySessions.length > 0) {
        const totalAnxiety = daySessions.reduce((sum, s) => sum + (s.total_anxiety_count || 0), 0)
        const hasAnxiety = totalAnxiety > 0
        hasAnxiety ? anxious++ : calm++
        days.push({ date: dateStr, day: d, hasAnxiety, hasData: true, fromReport: false })
      } else {
        days.push({ date: dateStr, day: d, hasAnxiety: false, hasData: false })
      }
    }
  }
  calendarDays.value = days
  monthStats.value = { calm, anxious }
}

function clickDay(d) {
  if (!d.hasData) return
  const report = reportMap.value[d.date]
  if (report) {
    selectedReport.value = {
      date: d.date,
      summary: report.summary_text,
      durationMinutes: report.stats_json?.durationMinutes || 0,
      anxietyCount: report.stats_json?.anxietyCount || 0,
      peakDb: report.stats_json?.peakDb || 0,
      peakTime: report.stats_json?.peakTime || 'N/A',
      sootheRate: report.stats_json?.sootheRate || 100,
    }
  } else {
    // Only has guard_sessions, no daily_report yet
    selectedReport.value = {
      date: d.date,
      summary: '该日有守护记录，但尚未生成 AI 总结。请停止守护后查看完整报告。',
      durationMinutes: 0,
      anxietyCount: d.hasAnxiety ? 1 : 0,
      peakDb: 0,
      peakTime: 'N/A',
      sootheRate: 100,
    }
  }
}

function prevMonth() {
  const [y, m] = currentMonth.value.split('-').map(Number)
  const newM = m === 1 ? 12 : m - 1
  const newY = m === 1 ? y - 1 : y
  currentMonth.value = `${newY}-${String(newM).padStart(2, '0')}`
  loadMonthData()
}

function nextMonth() {
  const [y, m] = currentMonth.value.split('-').map(Number)
  const newM = m === 12 ? 1 : m + 1
  const newY = m === 12 ? y + 1 : y
  currentMonth.value = `${newY}-${String(newM).padStart(2, '0')}`
  loadMonthData()
}
</script>

<template>
  <div class="min-h-screen bg-gradient-to-b from-amber-50 to-orange-50 p-4">
    <div class="max-w-lg mx-auto">
      <!-- Header -->
      <div class="flex items-center justify-between mb-6">
        <button @click="router.back()" class="text-amber-700 text-lg cursor-pointer">←</button>
        <h1 class="text-xl font-bold text-amber-800">情绪深度分析</h1>
        <button @click="router.push(`/reports/${route.params.petId}`)" class="text-sm text-amber-600 cursor-pointer">历史报告</button>
      </div>

      <!-- Month Picker -->
      <div class="flex items-center justify-between mb-4">
        <button @click="prevMonth" class="text-amber-600 cursor-pointer">◀</button>
        <span class="font-semibold text-gray-700">{{ currentMonth }}</span>
        <button @click="nextMonth" class="text-amber-600 cursor-pointer">▶</button>
      </div>

      <!-- Calendar Grid -->
      <div class="bg-white rounded-2xl p-4 shadow-sm mb-4">
        <div class="grid grid-cols-7 gap-1 text-center text-xs text-gray-500 mb-2">
          <span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span>
        </div>
        <div class="grid grid-cols-7 gap-1">
          <div v-for="d in calendarDays" :key="d.date"
            class="aspect-square flex items-center justify-center rounded-lg text-sm"
            :class="{
              'bg-green-100 text-green-700 hover:bg-green-200 cursor-pointer': d.hasData && !d.hasAnxiety,
              'bg-red-100 text-red-700 hover:bg-red-200 cursor-pointer': d.hasData && d.hasAnxiety,
              'text-gray-300 cursor-default': !d.hasData,
            }"
            @click="clickDay(d)">
            <span v-if="d.hasData">
              {{ d.hasAnxiety ? '🐾' : '✅' }}
            </span>
            <span v-else>{{ d.day }}</span>
          </div>
        </div>
      </div>

      <!-- Selected Day Detail -->
      <div v-if="selectedReport" class="bg-white rounded-2xl p-5 shadow-sm mb-4">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-semibold text-gray-800">{{ selectedReport.date }}</h3>
          <button @click="selectedReport = null" class="text-gray-400 hover:text-gray-600 cursor-pointer">✕</button>
        </div>
        <div class="bg-amber-50 rounded-xl p-3 mb-3">
          <p class="text-sm text-gray-700 leading-relaxed">{{ selectedReport.summary }}</p>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div class="bg-gray-50 rounded-xl p-3 text-center">
            <p class="text-lg font-bold text-amber-600">{{ selectedReport.durationMinutes }}</p>
            <p class="text-xs text-gray-500">守护时长(分钟)</p>
          </div>
          <div class="bg-gray-50 rounded-xl p-3 text-center">
            <p class="text-lg font-bold" :class="selectedReport.anxietyCount > 0 ? 'text-red-500' : 'text-green-500'">{{ selectedReport.anxietyCount }}</p>
            <p class="text-xs text-gray-500">焦虑次数</p>
          </div>
          <div class="bg-gray-50 rounded-xl p-3 text-center">
            <p class="text-lg font-bold text-amber-600">{{ selectedReport.peakDb }} dB</p>
            <p class="text-xs text-gray-500">峰值分贝</p>
          </div>
          <div class="bg-gray-50 rounded-xl p-3 text-center">
            <p class="text-lg font-bold text-green-500">{{ selectedReport.sootheRate }}%</p>
            <p class="text-xs text-gray-500">安抚率</p>
          </div>
        </div>
      </div>

      <!-- Pie Summary -->
      <div class="bg-white rounded-2xl p-5 shadow-sm">
        <h3 class="font-semibold text-gray-800 mb-3">本月情绪占比</h3>
        <div class="flex items-center justify-center gap-8">
          <div class="text-center">
            <div class="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-1">
              <span class="text-2xl">😊</span>
            </div>
            <p class="text-sm text-green-700 font-medium">平静 {{ monthStats.calm }} 天</p>
          </div>
          <div class="text-center">
            <div class="w-20 h-20 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-1">
              <span class="text-2xl">😰</span>
            </div>
            <p class="text-sm text-red-700 font-medium">焦虑 {{ monthStats.anxious }} 天</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
