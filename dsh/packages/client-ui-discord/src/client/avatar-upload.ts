import type { ChannelMember } from './channel-source.ts'

export interface CropRect { x: number; y: number; size: number; scale: number }

/** Coordinates are in source pixels; the frame is 256 logical pixels wide. */
export function cropRect(width: number, height: number, scale: number, x: number, y: number): CropRect {
  const minimum = 256 / Math.min(width, height)
  const boundedScale = Math.max(minimum, Math.min(Math.max(4, minimum), scale))
  const size = 256 / boundedScale
  return { x: Math.max(0, Math.min(width - size, x)), y: Math.max(0, Math.min(height - size, y)), size, scale: boundedScale }
}

export async function loadAvatar(file: File): Promise<HTMLImageElement> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('avatar-png')
  if (file.size > 10 * 1024 * 1024) throw new Error('avatar-size')
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('avatar-png'))
      image.src = url
    })
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('avatar-png')
    return image
  } catch (reason) { URL.revokeObjectURL(url); throw reason }
}

export class AvatarOutputSizeError extends Error {
  constructor(readonly bytes: number) { super('avatar-output-size') }
}

/** Export only the selected square, preserving proportions. */
export function avatarPng(image: HTMLImageElement, rect: CropRect): string {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const context = canvas.getContext('2d')
  if (!context) throw new Error('avatar-convert')
  context.drawImage(image, rect.x, rect.y, rect.size, rect.size, 0, 0, 256, 256)
  const data = canvas.toDataURL('image/png').split(',')[1]
  if (!data) throw new Error('avatar-convert')
  const bytes = atob(data).length
  if (bytes > 256 * 1024) throw new AvatarOutputSizeError(bytes)
  return data
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
