import { describe, expect, it } from 'vitest';
import { roleLabel } from './roleIdentity';

describe('roleLabel', () => {
  it('keeps the backend suffix when the name does not say it', () => {
    expect(roleLabel('鲸鱼娘', 'dsh')).toBe('鲸鱼娘·DSH');
  });
  it('drops the suffix when the name already starts with the backend (no 「DSH-1·DSH」)', () => {
    expect(roleLabel('DSH-1', 'dsh')).toBe('DSH-1');
    expect(roleLabel('codex-2', 'codex')).toBe('codex-2');
  });
});
