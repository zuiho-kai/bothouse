import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { getSessionModel } from '@/api/sessions';
import { useSessionModel } from './useSessionModel';

vi.mock('@/api/sessions', () => ({ getSessionModel: vi.fn() }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('refreshes model changes and looks up older conversations by ID', async () => {
  vi.useFakeTimers();
  const lookup = vi.mocked(getSessionModel);
  const container = document.createElement('div');
  const root = createRoot(container);

  function Badge({ id }: { id: string }) {
    return <span>{useSessionModel('role', 'bridge:web-admin:role', id)}</span>;
  }

  try {
    lookup.mockResolvedValueOnce({ model: 'initial-model' });
    await act(async () => root.render(<Badge id="s2" />));
    expect(lookup).toHaveBeenLastCalledWith('role', 'bridge:web-admin:role', 's2');
    expect(container.textContent).toBe('initial-model');

    lookup.mockResolvedValueOnce({ model: 'queued-model' });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(container.textContent).toBe('queued-model');

    lookup.mockResolvedValueOnce({ model: 'old-model' });
    await act(async () => root.render(<Badge id="s1" />));
    expect(lookup).toHaveBeenLastCalledWith('role', 'bridge:web-admin:role', 's1');
    expect(container.textContent).toBe('old-model');
  } finally {
    act(() => root.unmount());
    vi.useRealTimers();
  }
});
