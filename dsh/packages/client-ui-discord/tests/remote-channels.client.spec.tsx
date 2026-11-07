// @vitest-environment jsdom
// #236: a paired computer's channels page reads and writes that computer through the forwarder.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AttachmentList } from '../src/client/Attachments.tsx'
import { Avatar } from '../src/client/Avatar.tsx'
import { uploadAvatar } from '../src/client/avatar-upload.ts'
import { CollabUrlContext, mappedTransport, remoteCollabUrl } from '../src/client/collab-url.ts'
import { deliverableOf } from '../src/client/DeliveryPreview.tsx'
import type { ChannelMessage, ChannelTransport } from '../src/client/channel-source.ts'
import { zh } from '../src/client/locales.ts'

const LINK = '0f9b2c8e-1a2b-4c3d-8e9f-0123456789ab'
const remote = remoteCollabUrl(LINK)
const t = (key: keyof typeof zh) => String(zh[key])
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('maps collab paths to the link forwarder and leaves other urls alone', () => {
  expect(remote('collab/api/state')).toBe(`collab/remote/${LINK}/api/state`)
  expect(remote('collab/avatars/orange.png')).toBe(`collab/remote/${LINK}/avatars/orange.png`)
  expect(remote('https://example.com/x')).toBe('https://example.com/x')
  expect(() => remoteCollabUrl('../../api')).toThrow()
})

it('sends the channel transport (api and event stream) through the forwarder', () => {
  const base: ChannelTransport = {
    fetch: vi.fn(), openEvents: vi.fn(), delay: vi.fn(), random: () => 0,
    url: path => `http://dsh.local/${path}`,
  }
  const mapped = mappedTransport(base, remote)
  expect(mapped.url('collab/api/events')).toBe(`http://dsh.local/collab/remote/${LINK}/api/events`)
  expect(mapped.url('collab/api/rooms/3/messages')).toBe(`http://dsh.local/collab/remote/${LINK}/api/rooms/3/messages`)
})

it('shows avatars and attachments of the paired computer inside a remote panel', () => {
  const { container } = render(
    <CollabUrlContext.Provider value={remote}>
      <Avatar id="a" name="橘" avatar="orange" />
      <AttachmentList attachments={[{ id: 'f1', name: 'a.txt', mime: 'text/plain', size: 3 }]} t={t} />
    </CollabUrlContext.Provider>,
  )
  expect(container.querySelector('img')?.getAttribute('src')).toBe(`collab/remote/${LINK}/avatars/orange.png`)
  expect(screen.getByRole('link').getAttribute('href')).toBe(`collab/remote/${LINK}/api/attachments/f1`)
})

it('keeps local paths outside a remote panel', () => {
  const { container } = render(<Avatar id="a" name="橘" avatar="orange" />)
  expect(container.querySelector('img')?.getAttribute('src')).toBe('collab/avatars/orange.png')
})

it('uploads avatars and frames delivered pages on the paired computer', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ member: { id: 'm' } }), { status: 200 }))
  vi.stubGlobal('fetch', fetch)
  await uploadAvatar('m', 'AAAA', remote)
  expect(fetch.mock.calls[0]?.[0]).toBe(`collab/remote/${LINK}/api/members/m/avatar`)
  const message = { text: '', attachments: [{ id: 'p', name: 'page.html', mime: 'text/html', size: 1 }] } as unknown as ChannelMessage
  expect(deliverableOf(message, remote)?.src).toBe(`collab/remote/${LINK}/api/attachments/p?view=page`)
})
