import { create } from 'zustand'
import type { AuthSessionResponse, AuthSuccessResponse } from '@ai-canvas-cloud/contracts'
import { useProjectStore } from '@/store/useProjectStore'
import { fetchAuthSession, loginAuth, logoutAuth, registerAuth } from './api'

type AuthStatus = 'checking' | 'authenticated' | 'anonymous'

interface AuthStore {
  status: AuthStatus
  session: AuthSessionResponse | null
  error: string | null
  checkSession: () => Promise<void>
  login: (input: { email: string; password: string }) => Promise<void>
  register: (input: { email: string; password: string }) => Promise<void>
  logout: () => Promise<void>
}

function toSession(response: AuthSuccessResponse): AuthSessionResponse {
  return {
    user: response.user,
    workspace: response.workspace,
  }
}

export const useAuthStore = create<AuthStore>()((set) => ({
  status: 'checking',
  session: null,
  error: null,

  checkSession: async () => {
    set({ status: 'checking', error: null })

    try {
      const session = await fetchAuthSession()
      set({ status: 'authenticated', session, error: null })
    } catch (error) {
      useProjectStore.getState().resetForSession()
      set({
        status: 'anonymous',
        session: null,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },

  login: async (input) => {
    const response = await loginAuth(input)
    useProjectStore.getState().resetForSession()
    set({ status: 'authenticated', session: toSession(response), error: null })
  },

  register: async (input) => {
    const response = await registerAuth(input)
    useProjectStore.getState().resetForSession()
    set({ status: 'authenticated', session: toSession(response), error: null })
  },

  logout: async () => {
    await logoutAuth().catch(() => undefined)
    useProjectStore.getState().resetForSession()
    set({ status: 'anonymous', session: null, error: null })
  },
}))
