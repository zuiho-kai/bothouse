import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  isNotificationSupported,
  loadNotificationPreference,
  saveNotificationPreference,
  notifyMessage,
} from '../src/client/notifications.ts'

describe('notifications (#145)', () => {
  beforeEach(() => {
    saveNotificationPreference(true)
  })

  it('persists notification toggle preference', () => {
    saveNotificationPreference(false)
    expect(loadNotificationPreference()).toBe(false)
    saveNotificationPreference(true)
    expect(loadNotificationPreference()).toBe(true)
  })

  it('does not send notification when disabled by preference', () => {
    const notifySpy = vi.fn()
    vi.stubGlobal('Notification', Object.assign(notifySpy, { permission: 'granted' }))
    saveNotificationPreference(false)

    const res = notifyMessage({ title: 'test', body: 'body' })
    expect(res).toBeUndefined()
    expect(notifySpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('dispatches notification when permitted and enabled', () => {
    class FakeNotification {
      static permission: NotificationPermission = 'granted'
      title: string
      options: unknown
      constructor(title: string, options: unknown) {
        this.title = title
        this.options = options
      }
    }
    vi.stubGlobal('Notification', FakeNotification)
    saveNotificationPreference(true)

    const res = notifyMessage({ title: 'New Message', body: 'Bot says hi', tag: 'test-tag' })
    expect(res).toBeInstanceOf(FakeNotification)
    expect((res as unknown as { title: string }).title).toBe('New Message')
    vi.unstubAllGlobals()
  })
})
