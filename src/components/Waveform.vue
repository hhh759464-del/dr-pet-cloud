<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  timeData: { type: Uint8Array, default: () => new Uint8Array() },
  active: { type: Boolean, default: false },
})

const canvas = ref(null)
let animationId = null

function resize() {
  const c = canvas.value
  if (!c) return
  const rect = c.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  c.width = rect.width * dpr
  c.height = rect.height * dpr
  const ctx = c.getContext('2d')
  ctx.scale(dpr, dpr)
}

function draw() {
  const c = canvas.value
  if (!c) return
  const ctx = c.getContext('2d')
  const rect = c.getBoundingClientRect()
  const w = rect.width
  const h = rect.height

  // Only resize if dimensions changed (avoid clearing every frame)
  if (c._lastW !== w || c._lastH !== h) {
    c._lastW = w
    c._lastH = h
    const dpr = window.devicePixelRatio || 1
    c.width = w * dpr
    c.height = h * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  ctx.clearRect(0, 0, w, h)

  const data = props.timeData
  const sliceWidth = w / data.length

  ctx.beginPath()
  ctx.lineWidth = 2

  if (!props.active || data.length === 0 || data.every(v => v === 0)) {
    // Flat line
    ctx.strokeStyle = '#d4a574'
    ctx.moveTo(0, h / 2)
    ctx.lineTo(w, h / 2)
  } else {
    // Active waveform
    const gradient = ctx.createLinearGradient(0, 0, w, 0)
    gradient.addColorStop(0, '#f59e0b')
    gradient.addColorStop(0.5, '#ef4444')
    gradient.addColorStop(1, '#f59e0b')
    ctx.strokeStyle = gradient

    ctx.moveTo(0, h / 2)
    for (let i = 0; i < data.length; i++) {
      const v = data[i] / 128.0
      const y = (v * h) / 2
      ctx.lineTo(i * sliceWidth, y)
    }
  }
  ctx.stroke()

  animationId = requestAnimationFrame(draw)
}

onMounted(() => { animationId = requestAnimationFrame(draw) })
onUnmounted(() => { if (animationId) cancelAnimationFrame(animationId) })
</script>

<template>
  <canvas ref="canvas" class="w-full h-24 rounded-lg bg-amber-50/50" />
</template>
