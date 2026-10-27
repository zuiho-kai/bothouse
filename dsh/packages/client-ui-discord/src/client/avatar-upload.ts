import type { ChannelMember } from './channel-source.ts'

/** Browser-side conversion keeps the local server independent of image libraries. */
export async function avatarPng(file: File): Promise<string> {
  if (file.type !== 'image/png') throw new Error('avatar-png')
  if (file.size > 256 * 1024) throw new Error('avatar-size')
  const signature = new Uint8Array(await file.slice(0, 8).arrayBuffer())
  if (signature.join(',') !== '137,80,78,71,13,10,26,10') throw new Error('avatar-png')
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('avatar-png'))
      image.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 256
    const context = canvas.getContext('2d')
    if (!context) throw new Error('avatar-convert')
    context.drawImage(image, 0, 0, 256, 256)
    const data = canvas.toDataURL('image/png').split(',')[1]
    if (!data) throw new Error('avatar-convert')
    if (atob(data).length > 256 * 1024) throw new Error('avatar-size')
    return data
  } finally { URL.revokeObjectURL(url) }
}

export async function uploadAvatar(id: string, png?: string): Promise<ChannelMember> {
  const response = await fetch(`collab/api/members/${encodeURIComponent(id)}/avatar`, {
    method: png === undefined ? 'DELETE' : 'POST',
    headers: { 'content-type': 'application/json' },
    ...(png === undefined ? {} : { body: JSON.stringify({ png }) }),
  })
  const result = await response.json() as { member: ChannelMember; error?: string; code?: string }
  if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`)
  return result.member
}
