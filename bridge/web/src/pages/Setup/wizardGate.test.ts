import { describe, expect, it } from 'vitest';
import { wizardGate } from './wizardGate';

describe('wizardGate', () => {
  it('is on by default (checkbox shown, left ticked)', () => {
    expect(wizardGate(true, true)).toEqual({ enabled: true });
  });

  it('is off when the checkbox is unticked', () => {
    expect(wizardGate(true, false)).toEqual({ enabled: false });
  });

  it('stays on in the 飞书 flow, which has no checkbox', () => {
    // the 飞书 flow skips the routing step, so the (default-ticked) checkbox state is never seen
    expect(wizardGate(false, true)).toEqual({ enabled: true });
    expect(wizardGate(false, false)).toEqual({ enabled: true });
  });
});
