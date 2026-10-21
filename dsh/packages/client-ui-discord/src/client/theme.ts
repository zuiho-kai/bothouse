/**
 * Avatar palette and theme helpers driven by DSH semantic alias tokens.
 * Only theme tokens are allowed; raw hex colors (#...) are forbidden.
 */
export const PALETTE = [
  'var(--dsw-alias-state-business-primary)',
  'var(--dsw-alias-state-success-primary)',
  'var(--dsw-alias-state-warn-primary, var(--dsw-alias-state-warning-primary))',
  'var(--dsw-alias-state-error-primary)',
] as const

/**
 * Deterministically pick an avatar background token for a member ID.
 * @param id - unique member ID
 * @returns CSS variable token expression
 */
export function color(id: string): string {
  let h = 7
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length] as string
}
