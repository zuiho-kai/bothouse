/**
 * Desktop Notification API wrapper and preference persistence (#145).
 */

const STORAGE_KEY_NOTIFY = 'bothouse:channel_notifications_enabled'

let memoryStorage: Record<string, string> | undefined

function getStorage(): { getItem(k: string): string | null; setItem(k: string, v: string): void } | undefined {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
    if (typeof localStorage !== 'undefined') {
      localStorage.getItem('__test__')
      return localStorage
    }
  } catch {}
  if (!memoryStorage) memoryStorage = {}
  return {
    getItem: k => memoryStorage![k] ?? null,
    setItem: (k, v) => { memoryStorage![k] = v },
  }
}

/** Whether browser desktop notifications are supported in this environment. */
export function isNotificationSupported(): boolean {
  return (typeof window !== 'undefined' && 'Notification' in window) || typeof Notification !== 'undefined'
}

/** Current Notification.permission ('default' | 'granted' | 'denied' | 'unsupported'). */
export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!isNotificationSupported()) return 'unsupported'
  return typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
}

/** Load notification toggle preference (default: true). */
export function loadNotificationPreference(): boolean {
  const storage = getStorage()
  if (!storage) return true
  try {
    const val = storage.getItem(STORAGE_KEY_NOTIFY)
    return val === null ? true : val === 'true'
  } catch {
    return true
  }
}

/** Save notification toggle preference. */
export function saveNotificationPreference(enabled: boolean): void {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.setItem(STORAGE_KEY_NOTIFY, String(enabled))
  } catch {}
}

/** Request notification permission if not yet decided. */
export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!isNotificationSupported()) return 'unsupported'
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

export interface NotifyOptions {
  title: string
  body: string
  tag?: string
  onClick?: () => void
}

/**
 * Dispatch a system notification if enabled and permitted.
 */
export function notifyMessage(options: NotifyOptions): Notification | undefined {
  if (!isNotificationSupported()) return undefined
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return undefined
  if (!loadNotificationPreference()) return undefined
  try {
    const n = new Notification(options.title, {
      body: options.body,
      tag: options.tag,
    })
    if (options.onClick) {
      n.onclick = () => {
        if (typeof window !== 'undefined') window.focus?.()
        options.onClick?.()
        n.close()
      }
    }
    return n
  } catch {
    return undefined
  }
}
