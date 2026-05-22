import { ref } from 'vue'

function getSettings() {
  const saved = JSON.parse(localStorage.getItem('settings') || '{}')
  return {
    threshold: saved.threshold || 75,
    triggerDuration: (saved.triggerDelay || 2) * 1000,
    cooldown: (saved.cooldown || 60) * 1000,
  }
}

export function useAudio() {
  let thresholdDb = 75
  let triggerDurationMs = 2000
  let cooldownMs = 60000
  const isListening = ref(false)
  const currentDb = ref(0)
  const isTriggered = ref(false)
  const isPlayingSoothing = ref(false)
  const audioContext = ref(null)
  const analyser = ref(null)
  const stream = ref(null)
  const frequencyData = ref(new Uint8Array())
  const timeData = ref(new Uint8Array())

  let aboveThresholdSince = null
  let cooldownUntil = null
  let animationId = null
  let onTriggerCallback = null
  let onDbUpdateCallback = null

  async function startListening() {
    const s = getSettings()
    thresholdDb = s.threshold
    triggerDurationMs = s.triggerDuration
    cooldownMs = s.cooldown

    stream.value = await navigator.mediaDevices.getUserMedia({ audio: true })
    audioContext.value = new (window.AudioContext || window.webkitAudioContext)()
    analyser.value = audioContext.value.createAnalyser()
    analyser.value.fftSize = 256

    const source = audioContext.value.createMediaStreamSource(stream.value)
    source.connect(analyser.value)

    frequencyData.value = new Uint8Array(analyser.value.frequencyBinCount)
    timeData.value = new Uint8Array(analyser.value.frequencyBinCount)
    isListening.value = true

    loop()
  }

  function loop() {
    if (!isListening.value) return

    analyser.value.getByteFrequencyData(frequencyData.value)
    analyser.value.getByteTimeDomainData(timeData.value)

    // Calculate RMS-based dB approximation
    let sum = 0
    for (let i = 0; i < timeData.value.length; i++) {
      const normalized = (timeData.value[i] - 128) / 128
      sum += normalized * normalized
    }
    const rms = Math.sqrt(sum / timeData.value.length)
    const db = rms > 0 ? 20 * Math.log10(rms) + 94 : 0
    currentDb.value = Math.round(db)

    if (onDbUpdateCallback) onDbUpdateCallback(db)

    // Trigger logic
    const now = Date.now()
    if (cooldownUntil && now < cooldownUntil) {
      aboveThresholdSince = null
    } else if (db >= thresholdDb) {
      if (!aboveThresholdSince) {
        aboveThresholdSince = now
      } else if (now - aboveThresholdSince >= triggerDurationMs) {
        isTriggered.value = true
        aboveThresholdSince = null
        cooldownUntil = now + cooldownMs
        if (onTriggerCallback) onTriggerCallback()
      }
    } else {
      aboveThresholdSince = null
    }

    animationId = requestAnimationFrame(loop)
  }

  function setOnTrigger(cb) { onTriggerCallback = cb }
  function setOnDbUpdate(cb) { onDbUpdateCallback = cb }

  function stopListening() {
    isListening.value = false
    if (animationId) cancelAnimationFrame(animationId)
    if (stream.value) stream.value.getTracks().forEach(t => t.stop())
    if (audioContext.value) audioContext.value.close()
    audioContext.value = null
    analyser.value = null
    stream.value = null
    isTriggered.value = false
    isPlayingSoothing.value = false
    currentDb.value = 0
    aboveThresholdSince = null
    cooldownUntil = null
  }

  return {
    isListening, currentDb, isTriggered, isPlayingSoothing,
    frequencyData, timeData,
    startListening, stopListening,
    setOnTrigger, setOnDbUpdate,
  }
}
