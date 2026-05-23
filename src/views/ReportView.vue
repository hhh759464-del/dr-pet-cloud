<script setup>
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { supabase } from '../lib/supabase'
import { generateReportSummary } from '../lib/deepseek'

const router = useRouter()
const route = useRoute()

const loading = ref(true)
const summary = ref('')
const stats = ref({
  petName: '',
  date: '',
  durationMinutes: 0,
  anxietyCount: 0,
  peakDb: 0,
  peakTime: '',
  sootheRate: 0,
  vsYesterday: '',
})
const multiDayNote = ref('')
const petId = ref('')

async function getVsYesterday(petId, todayDate, todayAnxietyCount) {
  const d = new Date(todayDate)
  d.setDate(d.getDate() - 1)
  const yesterdayStr = d.toISOString().slice(0, 10)

  const { data } = await supabase
    .from('daily_reports')
    .select('stats_json')
    .eq('pet_id', petId)
    .eq('date', yesterdayStr)
    .maybeSingle()

  if (!data?.stats_json) return '昨天没有守护记录，明天就有对比数据啦'

  const yesterdayCount = data.stats_json.anxietyCount || 0
  if (todayAnxietyCount === yesterdayCount) return '和昨天持平，情绪稳定～'
  if (todayAnxietyCount < yesterdayCount) {
    const diff = yesterdayCount - todayAnxietyCount
    return `比昨天减少了 ${diff} 次焦虑，宝宝在进步！`
  }
  const diff = todayAnxietyCount - yesterdayCount
  return `比昨天增加了 ${diff} 次焦虑，可能今天状态不太好，明天继续观察～`
}

function buildStats(session, events, petName) {
  const anxietyCount = events?.length || 0
  const peak = events?.length ? events.reduce((max, e) => e.peak_db > max ? e.peak_db : max, -Infinity) : 0
  const peakEvent = events?.length ? events.find(e => e.peak_db === peak) : null
  const soothedCount = events?.filter(e => e.voice_played_id).length || 0
  const duration = session.end_time
    ? Math.round((new Date(session.end_time) - new Date(session.start_time)) / 60000)
    : 0

  return {
    petName: petName || '未知宠物',
    date: new Date(session.start_time).toLocaleDateString('zh-CN'),
    durationMinutes: duration,
    anxietyCount,
    peakDb: peak,
    peakTime: peakEvent ? new Date(peakEvent.triggered_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : 'N/A',
    sootheRate: anxietyCount > 0 ? Math.round((soothedCount / anxietyCount) * 100) : 100,
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
    await supabase.from('daily_reports').update({
      summary_text: text,
      stats_json: merged,
    }).eq('id', existing.id)
  } else {
    await supabase.from('daily_reports').insert({
      pet_id: petId,
      date,
      summary_text: text,
      stats_json: {
        durationMinutes: st.durationMinutes,
        anxietyCount: st.anxietyCount,
        peakDb: st.peakDb,
        peakTime: st.peakTime,
        sootheRate: st.sootheRate,
      },
    })
  }
}

onMounted(async () => {
  const { data: session } = await supabase
    .from('guard_sessions')
    .select('*, pets(name)')
    .eq('id', route.params.sessionId)
    .single()

  if (!session) {
    loading.value = false
    return
  }

  petId.value = session.pet_id
  const { data: events } = await supabase
    .from('anxiety_events')
    .select('*')
    .eq('session_id', session.id)
    .order('triggered_at', { ascending: true })

  const startDay = new Date(session.start_time).toISOString().slice(0, 10)
  const endDay = session.end_time
    ? new Date(session.end_time).toISOString().slice(0, 10)
    : startDay

  if (startDay !== endDay) {
    // Multi-day: split events by date
    const days = {}
    const allDays = new Set([startDay, endDay])
    events?.forEach(e => {
      const day = new Date(e.triggered_at).toISOString().slice(0, 10)
      if (!days[day]) days[day] = []
      days[day].push(e)
      allDays.add(day)
    })
    const sortedDays = [...allDays].sort()

    for (const day of sortedDays) {
      const dayEvents = days[day] || []
      const dayStart = new Date(`${day}T00:00:00`)
      const dayEnd = new Date(`${day}T23:59:59`)
      const sessionStart = new Date(session.start_time)
      const sessionEnd = session.end_time ? new Date(session.end_time) : new Date()
      const effectiveStart = sessionStart > dayStart ? sessionStart : dayStart
      const effectiveEnd = sessionEnd < dayEnd ? sessionEnd : dayEnd

      const fakeSession = {
        ...session,
        start_time: effectiveStart.toISOString(),
        end_time: effectiveEnd.toISOString(),
      }
      const dayStats = buildStats(fakeSession, dayEvents, session.pets?.name)
      dayStats.durationMinutes = Math.max(0, Math.round((effectiveEnd - effectiveStart) / 60000))
      dayStats.vsYesterday = await getVsYesterday(session.pet_id, day, dayStats.anxietyCount)
      const daySummary = await generateReportSummary({ ...dayStats, vsYesterday: dayStats.vsYesterday || '暂无昨日数据对比' })
      await saveReport(session.pet_id, day, daySummary, dayStats)
    }

    // Display the latest day's report
    const latestDay = sortedDays[sortedDays.length - 1]
    const latestEvents = days[latestDay] || []
    const latestStart = new Date(`${latestDay}T00:00:00`)
    const sessionEnd = session.end_time ? new Date(session.end_time) : new Date()
    const latestEnd = sessionEnd < new Date(`${latestDay}T23:59:59`) ? sessionEnd : new Date(`${latestDay}T23:59:59`)
    const fakeSession = {
      ...session,
      start_time: latestStart.toISOString(),
      end_time: latestEnd.toISOString(),
    }
    stats.value = buildStats(fakeSession, latestEvents, session.pets?.name)
    stats.value.durationMinutes = Math.max(0, Math.round((latestEnd - latestStart) / 60000))
    summary.value = await generateReportSummary(stats.value)
    multiDayNote.value = `本次守护跨越 ${sortedDays.length} 天，已生成 ${sortedDays.length} 份日报。可在「历史报告」中查看全部。`
  } else {
    const s = buildStats(session, events, session.pets?.name)
    s.vsYesterday = await getVsYesterday(session.pet_id, startDay, s.anxietyCount)
    stats.value = s
    summary.value = await generateReportSummary({ ...s, vsYesterday: s.vsYesterday || '暂无昨日数据对比' })
    await saveReport(session.pet_id, startDay, summary.value, s)
  }

  loading.value = false
})
</script>

<template>
  <div class="min-h-screen bg-gradient-to-b from-amber-50 to-orange-50 p-4">
    <div class="max-w-lg mx-auto">
      <!-- Header -->
      <div class="flex items-center gap-3 mb-6">
        <button @click="router.push('/pets')" class="text-amber-700 text-lg cursor-pointer">←</button>
        <h1 class="text-xl font-bold text-amber-800">今日守护报告</h1>
      </div>

      <div v-if="loading" class="text-center py-12 text-gray-400">生成报告中...</div>

      <template v-else>
        <!-- Multi-day note -->
        <div v-if="multiDayNote" class="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-sm text-amber-700">
          {{ multiDayNote }}
        </div>

        <!-- Summary Card -->
        <div class="bg-white rounded-2xl p-5 shadow-sm mb-4">
          <p class="text-sm text-gray-500 mb-1">{{ stats.date }}</p>
          <p class="text-gray-800 leading-relaxed">{{ summary }}</p>
        </div>

        <!-- Stats Grid -->
        <div class="grid grid-cols-2 gap-3 mb-4">
          <div class="bg-white rounded-xl p-4 shadow-sm text-center">
            <p class="text-2xl font-bold text-amber-600">{{ stats.durationMinutes }}</p>
            <p class="text-xs text-gray-500">守护时长(分钟)</p>
          </div>
          <div class="bg-white rounded-xl p-4 shadow-sm text-center">
            <p class="text-2xl font-bold text-red-500">{{ stats.anxietyCount }}</p>
            <p class="text-xs text-gray-500">焦虑事件次数</p>
          </div>
          <div class="bg-white rounded-xl p-4 shadow-sm text-center">
            <p class="text-2xl font-bold text-amber-600">{{ stats.peakDb }} dB</p>
            <p class="text-xs text-gray-500">峰值分贝</p>
          </div>
          <div class="bg-white rounded-xl p-4 shadow-sm text-center">
            <p class="text-2xl font-bold text-green-500">{{ stats.sootheRate }}%</p>
            <p class="text-xs text-gray-500">安抚介入率</p>
          </div>
        </div>

        <!-- Peak Alert -->
        <div v-if="stats.anxietyCount > 0" class="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
          <p class="text-sm font-medium text-red-700">峰值提示</p>
          <p class="text-sm text-red-600 mt-1">峰值出现在 {{ stats.peakTime }}，分贝达 {{ stats.peakDb }}dB。</p>
        </div>

        <!-- Trend -->
        <div class="bg-white rounded-xl p-4 shadow-sm mb-4 text-center">
          <p class="text-sm text-gray-500">对比昨日</p>
          <p class="text-lg font-semibold text-gray-700">{{ stats.vsYesterday || '暂无昨日数据对比' }}</p>
        </div>

        <!-- Actions -->
        <div class="space-y-2">
          <button @click="router.push(`/reports/${petId}`)"
            class="w-full py-3 bg-amber-100 hover:bg-amber-200 text-amber-800 font-semibold rounded-2xl transition cursor-pointer">
            查看历史报告
          </button>
          <button @click="router.push('/pets')"
            class="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-2xl transition cursor-pointer">
            确定
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
