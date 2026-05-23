<script setup>
import { ref } from 'vue'
import { supabase } from './lib/supabase'

const authReady = ref(false)

supabase.auth.getSession().then(() => {
  authReady.value = true
})

supabase.auth.onAuthStateChange(() => {
  authReady.value = true
})
</script>

<template>
  <div v-if="!authReady" class="min-h-screen flex items-center justify-center bg-amber-50">
    <div class="text-center">
      <div class="text-5xl mb-4 animate-pulse">🐾</div>
      <p class="text-amber-600 text-sm">加载中...</p>
    </div>
  </div>
  <router-view v-else />
</template>
