import { ref } from 'vue'

// ── default sizing & windowing constants (see PRD §6.4, §6.7) ──
const BODY_SIZE_DELTA = { small: 10, medium: 15, large: 20 }
const WINDOW_MS = 5000
const SAMPLE_INTERVAL_MS = 100
const MIN_SPIKE_POINTS = 3
const SPIKE_COUNT_TRIGGER = 3
const COOLDOWN_DEFAULT_MS = 60000

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

export function useAudio() {
  // ── reactive state ──
  const state = ref('idle') // idle | calibrating | monitoring | triggered | cooldown
  const isListening = ref(false)
  const currentDb = ref(0)
  const isTriggered = ref(false)
  const isPlayingSoothing = ref(false)
  const frequencyData = ref(new Uint8Array())
  const timeData = ref(new Uint8Array())
  const calibrationProgress = ref(0)   // 0–100, step 1 + step 2
  const calibrationStep = ref(0)       // 0=none, 1=env, 2=pet, 3=done

  // calibration results
  const E_base = ref(null)
  const P_peak = ref(null)
  let threshold = null     // computed threshold (relative dB)
  let windowMs = WINDOW_MS
  let cooldownMs = COOLDOWN_DEFAULT_MS

  // internals
  let audioContext = null
  let analyser = null
  let stream = null
  let sourceNode = null    // keep ref so we can disconnect/reconnect
  let animationId = null
  let onTriggerCallback = null
  let onDbUpdateCallback = null
  let onStateChangeCallback = null

  // sliding window
  let spikeBuffer = []      // ring buffer of 1 | 0 entries (50 entries for 5s @ 100ms)
  const maxBufLen = Math.ceil(WINDOW_MS / SAMPLE_INTERVAL_MS)

  // cooldown
  let cooldownUntil = null
  let cooldownTimer = null

  // marking mode
  let mediaRecorder = null
  let markingBuffer = []     // recent MediaStream chunks for pre-trigger window
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

  // ── calibration ──
  async function calibrate(petId, supabase, bodySize = 'medium') {
    changeState('calibrating')
    isListening.value = true
    calibrationStep.value = 1
    calibrationProgress.value = 0

    // ── step 1: environment baseline (10 s, 10 Hz) ──
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
        calibrationProgress.value = Math.min(100, Math.round((Date.now() - envStart) / 100))
        await new Promise(r => setTimeout(r, 100))
      }
      calibrationProgress.value = 100

      // discard outliers (> 2x mean)
      const envMean = envSamples.reduce((a, b) => a + b, 0) / envSamples.length
      const filtered = envSamples.filter(v => v <= envMean * 2)
      const eBase = filtered.reduce((a, b) => a + b, 0) / filtered.length
      E_base.value = Math.round(eBase)
    } catch (err) {
      changeState('idle')
      isListening.value = false
      throw new Error('麦克风权限被拒绝' + (err.message ? ': ' + err.message : ''))
    }

    // ── step 2: pet vocalization peak (15 s, optional) ──
    // Called externally: calibrateStep2() or skipStep2()
    // We store the setup so step2 can reuse the same AudioContext / stream.
    changeState('calibrating') // still calibrating, waiting for step 2

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

    if (p != null && p > e) {
      threshold = e + (p - e) * 0.5
    } else if (bodySize && BODY_SIZE_DELTA[bodySize] !== undefined) {
      threshold = e + BODY_SIZE_DELTA[bodySize]
      source = 'body_size_fallback'
    } else {
      threshold = e + 15
      source = 'body_size_fallback'
    }

    threshold = Math.round(threshold)
    calibrationStep.value = 3
    changeState('idle')
    isListening.value = false

    return { E_base: e, P_peak: p, threshold, source }
  }

  function getCalibration() {
    return { E_base: E_base.value, P_peak: P_peak.value, threshold }
  }

  function setCalibration(e, p, t) {
    E_base.value = e ?? null
    P_peak.value = p ?? null
    threshold = t ?? null
  }

  function hasCalibration() {
    return threshold != null && E_base.value != null
  }

  // ── monitoring loop ──
  async function startListening(mode = 'guard') {
    if (!hasCalibration()) throw new Error('请先完成校准')

    if (stream && audioContext && analyser) {
      // reuse existing audio context from calibration
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

    frequencyData.value = new Uint8Array(analyser.frequencyBinCount)
    timeData.value = new Uint8Array(analyser.frequencyBinCount)
    spikeBuffer = []
    isListening.value = true
    changeState('monitoring')

    // start MediaRecorder if marking mode
    if (mode === 'mark' && typeof MediaRecorder !== 'undefined') {
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/webm;codecs=opus'
      mediaRecorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64000 })

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) markingBuffer.push(e.data)
        // keep only the last ~10s of chunks (ring buffer)
        while (markingBuffer.length > 20) markingBuffer.shift()
      }
      mediaRecorder.start(500) // collect data every 500ms
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

    // sliding window spike detection
    const now = Date.now()

    if (state.value === 'monitoring') {
      pushSpike(db >= threshold ? 1 : 0)
      const spikes = countSpikes()
      if (spikes >= SPIKE_COUNT_TRIGGER) {
        // trigger!
        changeState('triggered')
        isTriggered.value = true
        spikeBuffer = []
        if (onTriggerCallback) onTriggerCallback(db, markingBuffer)
      }
    }

    animationId = requestAnimationFrame(loop)
  }

  // ── cooldown management ──
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

  // ── marking: save snippet ──
  function captureSnippet() {
    if (!markingBuffer.length) return null
    const blob = new Blob(markingBuffer.slice(-6), { type: 'audio/webm' }) // last ~3s pre-trigger
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

  return {
    state, isListening, currentDb, isTriggered, isPlayingSoothing,
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
  }
}
