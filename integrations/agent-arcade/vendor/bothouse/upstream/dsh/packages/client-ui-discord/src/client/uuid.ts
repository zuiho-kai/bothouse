/**
 * v4 UUID that also works outside a secure context. `crypto.randomUUID` exists only
 * on https/localhost pages, so a channel page opened at a plain-http LAN or Tailscale
 * address has no such method; `crypto.getRandomValues` is available everywhere.
 * Same approach as upstream DSH's `@deepseek-ai/dsh-util-crypto` randomUUID, which is
 * not loadable here because the bundle keeps `@deepseek-ai/*` external.
 * @returns a canonical lowercase v4 UUID string.
 */
export function randomUUID(): string {
  const c = globalThis.crypto
  if (typeof c.randomUUID === 'function') return c.randomUUID()
  const bytes = c.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
