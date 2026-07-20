import { create } from 'zustand'

export type NotificationKind = 'broadcast' | 'error' | 'system'
export type NotificationLevel = 'info' | 'warning' | 'error'

export interface AppNotification {
  id: string
  dedupeKey?: string
  kind: NotificationKind
  level: NotificationLevel
  title: string
  message?: string
  diagnosticId?: string
  createdAt: string
  readAt: string | null
  occurrences: number
}

export interface PushNotificationInput {
  kind: NotificationKind
  level?: NotificationLevel
  title: string
  message?: string
  diagnosticId?: string
  dedupeKey?: string
  createdAt?: string
}

interface NotificationStore {
  items: AppNotification[]
  push: (input: PushNotificationInput) => string
  markRead: (id: string) => void
  markAllRead: () => void
  remove: (id: string) => void
  clear: () => void
}

const MAX_NOTIFICATION_COUNT = 100

function createNotificationId() {
  return `notification-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export const useNotificationStore = create<NotificationStore>()((set) => ({
  items: [],

  push: (input) => {
    const createdAt = input.createdAt ?? new Date().toISOString()
    let notificationId = createNotificationId()

    set((state) => {
      const duplicate = state.items.find((item) => (
        (input.dedupeKey && item.dedupeKey === input.dedupeKey)
        || (!input.dedupeKey
          && item.readAt === null
          && item.kind === input.kind
          && item.title === input.title
          && item.message === input.message)
      ))

      if (duplicate) {
        notificationId = duplicate.id
        if (input.dedupeKey) {
          return state
        }
        return {
          items: state.items.map((item) => item.id === duplicate.id
            ? {
                ...item,
                level: input.level ?? item.level,
                diagnosticId: input.diagnosticId ?? item.diagnosticId,
                createdAt,
                occurrences: item.occurrences + 1,
              }
            : item),
        }
      }

      return {
        items: [{
          id: notificationId,
          dedupeKey: input.dedupeKey,
          kind: input.kind,
          level: input.level ?? 'info',
          title: input.title,
          message: input.message,
          diagnosticId: input.diagnosticId,
          createdAt,
          readAt: null,
          occurrences: 1,
        }, ...state.items].slice(0, MAX_NOTIFICATION_COUNT),
      }
    })

    return notificationId
  },

  markRead: (id) => set((state) => ({
    items: state.items.map((item) => item.id === id && item.readAt === null
      ? { ...item, readAt: new Date().toISOString() }
      : item),
  })),

  markAllRead: () => {
    const readAt = new Date().toISOString()
    set((state) => ({
      items: state.items.map((item) => item.readAt === null ? { ...item, readAt } : item),
    }))
  },

  remove: (id) => set((state) => ({
    items: state.items.filter((item) => item.id !== id),
  })),

  clear: () => set({ items: [] }),
}))
