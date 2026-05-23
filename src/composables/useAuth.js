import { ref, onMounted } from 'vue'
import { supabase } from '../lib/supabase'

const user = ref(null)
const loading = ref(true)

export function useAuth() {
  onMounted(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      user.value = session?.user || null
      loading.value = false
    })

    supabase.auth.onAuthStateChange((_event, session) => {
      user.value = session?.user || null
    })
  })

  async function signUp(email, password) {
    const { data, error } = await supabase.auth.signUp({ email, password })
    return { data, error }
  }

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    return { data, error }
  }

  async function signOut() {
    await supabase.auth.signOut()
    user.value = null
    window.location.href = '/auth'
  }

  return { user, loading, signUp, signIn, signOut }
}
