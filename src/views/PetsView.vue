<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { useAuth } from '../composables/useAuth'

const router = useRouter()
const { user, signOut } = useAuth()

const pets = ref([])
const showAdd = ref(false)
const newPet = ref({ name: '', type: 'dog', breed: '' })

async function loadPets() {
  const { data } = await supabase.from('pets').select('*').eq('owner_id', user.value?.id)
  pets.value = data || []
}

async function addPet() {
  if (!newPet.value.name.trim()) return
  await supabase.from('pets').insert({
    owner_id: user.value.id,
    name: newPet.value.name.trim(),
    type: newPet.value.type,
    breed: newPet.value.breed.trim(),
  })
  newPet.value = { name: '', type: 'dog', breed: '' }
  showAdd.value = false
  loadPets()
}

async function deletePet(id) {
  if (!confirm('确定删除这只宠物吗？相关的语音文件和守护报告将全部被删除，不可恢复。')) return
  await supabase.from('pets').delete().eq('id', id)
  loadPets()
}

onMounted(loadPets)
</script>

<template>
  <div class="min-h-screen bg-gradient-to-b from-amber-50 to-orange-50 p-4">
    <div class="max-w-lg mx-auto">
      <!-- Header -->
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-xl font-bold text-amber-800">🐾 宠博士·云伴</h1>
          <p class="text-sm text-amber-600">我的宠物</p>
        </div>
        <button @click="signOut" class="text-sm text-gray-500 hover:text-gray-700 cursor-pointer">退出登录</button>
      </div>

      <!-- Pet Cards -->
      <div class="space-y-3 mb-6">
        <div v-for="pet in pets" :key="pet.id"
          class="bg-white rounded-2xl p-4 shadow-sm flex items-center gap-4 hover:shadow-md transition cursor-pointer"
          @click="router.push(`/standby/${pet.id}`)">
          <div class="text-4xl">
            {{ pet.type === 'dog' ? '🐶' : pet.type === 'cat' ? '🐱' : '🐾' }}
          </div>
          <div class="flex-1">
            <h3 class="font-semibold text-gray-800">{{ pet.name }}</h3>
            <p class="text-sm text-gray-500">{{ pet.breed || pet.type }}</p>
          </div>
          <button @click.stop="deletePet(pet.id)" class="text-red-400 hover:text-red-600 text-sm cursor-pointer">删除</button>
        </div>

        <!-- Empty state -->
        <div v-if="pets.length === 0" class="text-center py-12 text-gray-400">
          <div class="text-5xl mb-3">🐾</div>
          <p>还没有添加宠物，点击下方按钮添加吧</p>
        </div>
      </div>

      <!-- Add Pet Form -->
      <div v-if="showAdd" class="bg-white rounded-2xl p-5 shadow-sm mb-4">
        <h3 class="font-semibold text-gray-800 mb-4">添加新宠物</h3>
        <div class="space-y-3">
          <input v-model="newPet.name" placeholder="宠物名字" required
            class="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-400" />
          <select v-model="newPet.type"
            class="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-400">
            <option value="dog">🐶 狗</option>
            <option value="cat">🐱 猫</option>
            <option value="other">🐾 其他</option>
          </select>
          <input v-model="newPet.breed" placeholder="品种（选填）"
            class="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-400" />
          <div class="flex gap-2">
            <button @click="addPet"
              class="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-medium rounded-xl transition cursor-pointer">确认添加</button>
            <button @click="showAdd = false"
              class="px-6 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl transition cursor-pointer">取消</button>
          </div>
        </div>
      </div>

      <!-- Add Button -->
      <button v-if="!showAdd" @click="showAdd = true"
        class="w-full py-3 border-2 border-dashed border-amber-300 text-amber-600 rounded-2xl hover:bg-amber-100 transition font-medium cursor-pointer">
        + 添加新宠物
      </button>
    </div>
  </div>
</template>
