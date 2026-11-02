import { describe, expect, it } from 'vitest';
import { wizardGate } from './wizardGate';

describe('wizardGate', () => {
  it('saves called-only and smart modes and preserves skipped steps', () => {
    expect(wizardGate(true, true, 'addressed')).toEqual({ enabled: true, mode: 'addressed' });
    expect(wizardGate(true, false, 'smart')).toEqual({ enabled: true, mode: 'smart' });
    expect(wizardGate(true, true, 'off')).toEqual({ enabled: false });
    expect(wizardGate(false, true, 'addressed')).toBeUndefined();
  });
  it('is on when the checkbox is shown and ticked (the default)', () => {
    expect(wizardGate(true, true)).toEqual({ enabled: true });
  });

  it('is off when the checkbox is unticked', () => {
    expect(wizardGate(true, false)).toEqual({ enabled: false });
  });

  it('sends no field in flows without the checkbox, so the server keeps the saved choice', () => {
    // 飞书, single-role 自建平台 and add-role skip the routing step: an earlier "off" must stay off
    expect(wizardGate(false, true)).toBeUndefined();
    expect(wizardGate(false, false)).toBeUndefined();
  });
});
