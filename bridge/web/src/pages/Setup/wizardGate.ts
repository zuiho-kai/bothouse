/** Omitted steps preserve the saved platform choice on the server. */
export type GateMode = 'smart' | 'addressed' | 'off';
export function wizardGate(shown: boolean, checked: boolean, mode?: GateMode): { enabled: boolean; mode?: 'smart' | 'addressed' } | undefined {
  if (!shown) return undefined;
  if (!mode) return { enabled: checked };
  return mode === 'off' ? { enabled: false } : { enabled: true, mode };
}
