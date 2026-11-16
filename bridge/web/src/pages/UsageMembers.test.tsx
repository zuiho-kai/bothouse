import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import UsageMembers from './UsageMembers';
import { getUsage, type UsageRow } from '@/api/usage';
vi.mock('@/api/usage', () => ({ getUsage: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (s: string) => s }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const container = document.createElement('div');
const root = createRoot(container);
afterEach(() => { act(() => root.render(null)); vi.clearAllMocks(); });
const row = (account: string, total: number, cost?: number): UsageRow => ({
  member: { platform: 'p', account, name: account }, hour: -1,
  input_tokens: total, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
  total_tokens: total, responses: 1, unknown_usage_responses: 0, unpriced_responses: cost === undefined ? 1 : 0, estimated_cost: cost,
});
it('ranks tokens and costs, keeps unpriced usage visible, and filters all member details', async () => {
  vi.mocked(getUsage).mockImplementation(async group => ({ from: '2026-11-01', to: '2026-11-17', timezone: 'UTC', items: group === 'members' ? [row('Alice', 100, 2), row('Bob', 200, 1), { ...row('system', 50), member: undefined }] : [] }));
  await act(async () => { root.render(<UsageMembers from="2026-11-01" to="2026-11-17" role="r" model="m" revision={0} unit="raw" nameOf={s => s} />); });
  expect(container.querySelector('tbody tr button')?.textContent).toBe('Bob');
  expect(container.textContent).toContain('usage.membersUnattributed');
  await act(async () => { const select = container.querySelector('select')!; select.value = 'cost'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(container.querySelector('tbody tr button')?.textContent).toBe('Alice');
  await act(async () => { (container.querySelector('tbody tr button') as HTMLButtonElement).click(); });
  for (const group of ['daily', 'roles', 'models']) expect(getUsage).toHaveBeenCalledWith(group, { from:'2026-11-01', to:'2026-11-17', role:'r', model:'m', member:'p:Alice' });
});
it('renders the empty state', async () => {
  vi.mocked(getUsage).mockResolvedValue({from:'', to:'', timezone:'UTC', items:[]});
  await act(async () => {root.render(<UsageMembers from="" to="" role="" model="" revision={0} unit="raw" nameOf={s=>s}/>);});
  expect(container.textContent).toContain('usage.empty');
});
