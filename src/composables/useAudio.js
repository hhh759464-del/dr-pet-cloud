import { ref, computed } from 'vue'

// ── default sizing & windowing constants (see PRD §6.4, §6.7) ──
const BODY_SIZE_DELTA = { small: 10, medium: 15, large: 20 }
const WINDOW_MS = 5000
const SAMPLE_INTERVAL_MS = 100
const MIN_SPIKE_POINTS = 3
const SPIKE_COUNT_TRIGGER = 3
const COOLDOWN_DEFAULT_MS = 60000

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

// ── module-level shared state (persists across useAudio() calls) ──
const E_base = ref(null)
const P_peak = ref(null)
let threshold = null
let windowMs = WINDOW_MS
let cooldownMs = COOLDOWN_DEFAULT_MS

export function useAudio() {
  const state = ref('idle') // idle | calibrating | monitoring | triggered | cooldown
  const isListening = ref(false)
  const currentDb = ref(0)
  const isTriggered = ref(false)
  const isPlayingSoothing = ref(false)
  const frequencyData = ref(new Uint8Array(128).fill(0))
  const timeData = ref(new Uint8Array(128).fill(128))
  const calibrationProgress = ref(0)
  const calibrationStep = ref(0)       // 0=none, 1=env, 2=pet, 3=done

  // Display dB: currentDb relative to E_base (0 = environment baseline)
  const displayDb = computed(() => {
    const e = E_base.value
    if (e == null) return currentDb.value
    return Math.round(currentDb.value - e)
  })

  let audioContext = null
  let analyser = null
  let stream = null
  let sourceNode = null
  let animationId = null
  let onTriggerCallback = null
  let onDbUpdateCallback = null
  let onStateChangeCallback = null

  let spikeBuffer = []
  const maxBufLen = Math.ceil(WINDOW_MS / SAMPLE_INTERVAL_MS)

  let cooldownUntil = null
  let cooldownTimer = null

  let mediaRecorder = null
  let markingBuffer = []
  let markingPetId = null
  let markingSessionId = null

  // ── helpers ──
  function computeDb(timeDataArr) {
    let sum = 0
    for (let i = 0; i < timeDataArr.length; i++) {
      const n = (timeDataArr[i] - 128) / 128
      sum += n * n
    }
    const rms = Math.sqrt(sum / timeDataArr.length)
    return rms > 0 ? 20 * Math.log10(rms) : -100
  }

  function countSpikes() {
    let spikes = 0
    let run = 0
    for (let i = 0; i < spikeBuffer.length; i++) {
      if (spikeBuffer[i] === 1) {
        run++
      } else {
        if (run >= MIN_SPIKE_POINTS) spikes++
        run = 0
      }
    }
    if (run >= MIN_SPIKE_POINTS) spikes++
    return spikes
  }

  function pushSpike(val) {
    spikeBuffer.push(val)
    if (spikeBuffer.length > maxBufLen) spikeBuffer.shift()
  }

  function changeState(newState) {
    const prev = state.value
    state.value = newState
    if (onStateChangeCallback) onStateChangeCallback(newState, prev)
  }

  // ── mic disconnect / reconnect ──
  function disconnectMic() {
    if (sourceNode && analyser) {
      try { sourceNode.disconnect(analyser) } catch (_) { /* already disconnected */ }
    }
  }
  function reconnectMic() {
    if (sourceNode && analyser) {
      try { sourceNode.connect(analyser) } catch (_) { /* already connected */ }
    }
  }

  // ── quick auto-baseline: sample 2s of ambient noise ──
  async function quickBaseline() {
    const samples = []
    const buf = new Uint8Array(analyser.frequencyBinCount)
    const t0 = Date.now()
    while (Date.now() - t0 < 2000) {
      analyser.getByteTimeDomainData(buf)
      samples.push(computeDb(buf))
      await new Promise(r => setTimeout(r, 100))
    }
    samples.sort((a, b) => a - b)
    // Use lower third as baseline (ignore transient noises)
    const lower = samples.slice(0, Math.ceil(samples.length / 3))
    const baseline = lower.reduce((a, b) => a + b, 0) / lower.length
    E_base.value = Math.round(baseline)
  }

  // ── calibration ──
  async function calibrate(petId, supabase, bodySize = 'medium') {
    changeState('calibrating')
    isListening.value = true
    calibrationStep.value = 1
    calibrationProgress.value = 0

    const envSamples = []
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      audioContext = new (window.AudioContext || window.webkitAudioContext)()
      analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      sourceNode = audioContext.createMediaStreamSource(stream)
      sourceNode.connect(analyser)

      const envTimeData = new Uint8Array(analyser.frequencyBinCount)
      const envStart = Date.now()

      while (Date.now() - envStart < 10000) {
        analyser.getByteTimeDomainData(envTimeData)
        const db = computeDb(envTimeData)
        envSamples.push(db)
        currentDb.value = Math.round(db)
        calibrationProgress.value = Math.min(100, Math.round((Date.now() - envStart) / 100))
        await new Promise(r => setTimeout(r, 100))
      }
      calibrationProgress.value = 100

      const envMean = envSamples.reduce((a, b) => a + b, 0) / envSamples.length
      const filtered = envSamples.filter(v => v <= envMean * 2)
      const eBase = filtered.reduce((a, b) => a + b, 0) / filtered.length
      E_base.value = Math.round(eBase)
    } catch (err) {
      changeState('idle')
      isListening.value = false
      throw new Error('麦克风权限被拒绝' + (err.message ? ': ' + err.message : ''))
    }

    changeState('calibrating')
    return { eBase: E_base.value, done: false }
  }

  async function calibrateStep2() {
    calibrationStep.value = 2
    calibrationProgress.value = 0

    const samples = []
    const timeDataArr = new Uint8Array(analyser.frequencyBinCount)
    const start = Date.now()

    while (Date.now() - start < 15000) {
      analyser.getByteTimeDomainData(timeDataArr)
      const db = computeDb(timeDataArr)
      samples.push(db)
      currentDb.value = Math.round(db)
      calibrationProgress.value = Math.min(100, Math.round((Date.now() - start) / 150))
      await new Promise(r => setTimeout(r, 100))
    }
    calibrationProgress.value = 100

    if (samples.length === 0) return null
    samples.sort((a, b) => b - a)
    const top3 = samples.slice(0, Math.min(3, samples.length))
    const pPeak = top3.reduce((a, b) => a + b, 0) / top3.length
    P_peak.value = Math.round(pPeak)
    return P_peak.value
  }

  function applyCalibration(bodySize, source = 'calibration') {
    const e = E_base.value
    const p = P_peak.value
    const delta = (bodySize && BODY_SIZE_DELTA[bodySize]) || 15

    if (e == null) {
      console.warn('[useAudio] applyCalibration: E_base is null, using delta as threshold')
      E_base.value = 0
      threshold = Math.round(delta)
    } else if (p != null && p > e) {
      threshold = Math.round(e + (p - e) * 0.5)
      source = 'calibration'
    } else {
      threshold = Math.round(e + delta)
      source = 'body_size_fallback'
    }

    calibrationStep.value = 3
    changeState('idle')
    isListening.value = false

    return { E_base: E_base.value, P_peak: p, threshold, source }
  }

  function getCalibration() {
    return { E_base: E_base.value, P_peak: P_peak.value, threshold }
  }

  function setCalibration(e, p, t) {
    if (e != null) E_base.value = e
    if (p != null) P_peak.value = p
    if (t != null) threshold = t
  }

  function hasCalibration() {
    return threshold != null && E_base.value != null
  }

  // ── monitoring loop ──
  async function startListening(mode = 'guard', bodySize = 'medium') {
    // Set up audio context first
    if (stream && audioContext && analyser) {
      reconnectMic()
    } else {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        audioContext = new (window.AudioContext || window.webkitAudioContext)()
        analyser = audioContext.createAnalyser()
        analyser.fftSize = 256
        sourceNode = audioContext.createMediaStreamSource(stream)
        sourceNode.connect(analyser)
      } catch (err) {
        throw new Error('麦克风权限被拒绝')
      }
    }

    // Quick 2s auto-baseline if no calibration exists
    if (!hasCalibration()) {
      await quickBaseline()
      applyCalibration(bodySize, 'body_size_fallback')
    }

    frequencyData.value = new Uint8Array(analyser.frequencyBinCount)
    timeData.value = new Uint8Array(analyser.frequencyBinCount)
    spikeBuffer = []
    isListening.value = true
    changeState('monitoring')

    if (mode === 'mark' && typeof MediaRecorder !== 'undefined') {
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/webm;codecs=opus'
      mediaRecorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64000 })
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) markingBuffer.push(e.data)
        while (markingBuffer.length > 20) markingBuffer.shift()
      }
      mediaRecorder.start(500)
    }

    loop()
  }

  function loop() {
    if (!isListening.value) return

    analyser.getByteFrequencyData(frequencyData.value)
    analyser.getByteTimeDomainData(timeData.value)

    const db = computeDb(timeData.value)
    currentDb.value = Math.round(db)
    if (onDbUpdateCallback) onDbUpdateCallback(db)

    if (state.value === 'monitoring') {
      pushSpike(db >= threshold ? 1 : 0)
      const spikes = countSpikes()
      if (spikes >= SPIKE_COUNT_TRIGGER) {
        changeState('triggered')
        isTriggered.value = true
        spikeBuffer = []
        if (onTriggerCallback) onTriggerCallback(db, markingBuffer)
      }
    }

    animationId = requestAnimationFrame(loop)
  }

  // ── cooldown ──
  function startCooldown() {
    changeState('cooldown')
    reconnectMic()
    cooldownUntil = Date.now() + cooldownMs
    spikeBuffer = []

    if (cooldownTimer) clearTimeout(cooldownTimer)
    cooldownTimer = setTimeout(() => {
      if (state.value === 'cooldown') {
        changeState('monitoring')
        cooldownUntil = null
      }
    }, cooldownMs)
  }

  function getCooldownRemaining() {
    if (!cooldownUntil) return 0
    return Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000))
  }

  // ── marking ──
  function captureSnippet() {
    if (!markingBuffer.length) return null
    const blob = new Blob(markingBuffer.slice(-6), { type: 'audio/webm' })
    return blob
  }

  function setMarkingContext(petId, sessionId) {
    markingPetId = petId
    markingSessionId = sessionId
  }

  function getMarkingContext() {
    return { petId: markingPetId, sessionId: markingSessionId }
  }

  // ── public setup ──
  function setOnTrigger(cb) { onTriggerCallback = cb }
  function setOnDbUpdate(cb) { onDbUpdateCallback = cb }
  function setOnStateChange(cb) { onStateChangeCallback = cb }

  function setWindowMs(ms) {
    windowMs = clamp(ms, 3000, 8000)
  }
  function setCooldownMs(ms) {
    cooldownMs = clamp(ms, 30000, 120000)
  }
  function getThreshold() { return threshold }
  function getEBase() { return E_base.value }

  function adjustThreshold(delta) {
    if (!hasCalibration()) return
    const lo = E_base.value + 5
    const hi = E_base.value + 40
    threshold = clamp(Math.round(threshold + delta), lo, hi)
  }

  // ── stop ──
  function stopListening() {
    isListening.value = false
    changeState('idle')
    if (animationId) cancelAnimationFrame(animationId)
    if (cooldownTimer) clearTimeout(cooldownTimer)
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop()
      mediaRecorder = null
    }
    disconnectMic()
    if (stream) {
      stream.getTracks().forEach(t => t.stop())
      stream = null
    }
    if (audioContext) {
      audioContext.close()
      audioContext = null
    }
    analyser = null
    sourceNode = null
    isTriggered.value = false
    isPlayingSoothing.value = false
    currentDb.value = 0
    spikeBuffer = []
    cooldownUntil = null
    markingBuffer = []
    markingPetId = null
    markingSessionId = null
  }

  function toDisplayDb(rawDb) {
    const e = E_base.value
    if (e == null) return rawDb
    return Math.round(rawDb - e)
  }

  return {
    state, isListening, currentDb, displayDb, isTriggered, isPlayingSoothing,
    frequencyData, timeData,
    calibrationProgress, calibrationStep,
    E_base, P_peak,
    calibrate, calibrateStep2, applyCalibration,
    getCalibration, setCalibration, hasCalibration,
    startListening, stopListening,
    setOnTrigger, setOnDbUpdate, setOnStateChange,
    setWindowMs, setCooldownMs,
    getThreshold, getEBase, adjustThreshold,
    disconnectMic, reconnectMic, startCooldown,
    getCooldownRemaining,
    captureSnippet, setMarkingContext, getMarkingContext,
    toDisplayDb,
  }
}
