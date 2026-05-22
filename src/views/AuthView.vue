<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'

const router = useRouter()
const { signIn, signUp } = useAuth()

const isLogin = ref(true)
const email = ref('')
const password = ref('')
const errorMsg = ref('')
const loading = ref(false)

async function submit() {
  errorMsg.value = ''
  loading.value = true
  const { error } = isLogin.value
    ? await signIn(email.value, password.value)
    : await signUp(email.value, password.value)
  loading.value = false
  if (error) {
    errorMsg.value = error.message
  } else {
    router.push('/pets')
  }
}
</script>

<template>
  <div class="min-h-screen bg-gradient-to-b from-amber-50 to-orange-50 flex items-center justify-center p-4">
    <div class="w-full max-w-md">
      <!-- Logo -->
      <div class="text-center mb-8">
        <div class="text-6xl mb-3">🐾</div>
        <h1 class="text-2xl font-bold text-amber-800">宠博士·云伴</h1>
        <p class="text-amber-600 mt-1 text-sm">Dr. Pet · Cloud Companion</p>
      </div>

      <!-- Form Card -->
      <div class="bg-white rounded-2xl shadow-lg p-8">
        <h2 class="text-xl font-semibold text-gray-800 mb-6 text-center">
          {{ isLogin ? '欢迎回来' : '创建账号' }}
        </h2>

        <!-- Error -->
        <div v-if="errorMsg" class="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
          {{ errorMsg }}
        </div>

        <form @submit.prevent="submit" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">邮箱</label>
            <input
              v-model="email"
              type="email"
              required
              placeholder="your@email.com"
              class="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">密码</label>
            <input
              v-model="password"
              type="password"
              required
              minlength="6"
              placeholder="至少6位密码"
              class="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition"
            />
          </div>
          <button
            type="submit"
            :disabled="loading"
            class="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white font-semibold rounded-xl transition cursor-pointer"
          >
            {{ loading ? '处理中...' : (isLogin ? '登录' : '注册') }}
          </button>
        </form>

        <p class="mt-6 text-center text-sm text-gray-500">
          {{ isLogin ? '还没有账号？' : '已有账号？' }}
          <button @click="isLogin = !isLogin; errorMsg = ''" class="text-amber-600 hover:text-amber-700 font-medium cursor-pointer">
            {{ isLogin ? '去注册' : '去登录' }}
          </button>
        </p>
      </div>
    </div>
  </div>
</template>
