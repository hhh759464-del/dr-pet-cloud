const DEEPSEEK_API_KEY = import.meta.env.VITE_DEEPSEEK_API_KEY
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions'

export async function generateReportSummary(stats) {
  if (!DEEPSEEK_API_KEY || DEEPSEEK_API_KEY === 'your_deepseek_api_key_here') {
    return generateFallbackSummary(stats)
  }

  try {
    const res = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{
          role: 'user',
          content: `你是一位温柔的宠物情绪分析师。请根据以下数据生成一段50字左右的宠物情绪日报总结，语气亲切温暖：

- 宠物名字：${stats.petName}
- 守护时长：${stats.durationMinutes} 分钟
- 焦虑事件次数：${stats.anxietyCount} 次
- 峰值分贝：${stats.peakDb} dB
- 峰值时间：${stats.peakTime}
- 安抚成功率：${stats.sootheRate}%
- 对比昨日：${stats.vsYesterday}

直接输出总结文字，不要加任何前缀。`,
        }],
        max_tokens: 200,
        temperature: 0.8,
      }),
    })

    const json = await res.json()
    return json.choices?.[0]?.message?.content || generateFallbackSummary(stats)
  } catch {
    return generateFallbackSummary(stats)
  }
}

function generateFallbackSummary(stats) {
  const name = stats.petName || '宝贝'
  if (stats.anxietyCount === 0) {
    return `今天${name}超级乖 🥰 全程安安静静，没有检测到任何焦虑波动。是个省心的小天使！`
  }
  return `今日${name}有些小情绪 🥺 监测到 ${stats.anxietyCount} 次明显的焦虑波动，峰值出现在 ${stats.peakTime}。好在 AI 已成功介入安抚，安抚率 ${stats.sootheRate}%。${stats.vsYesterday}`
}
