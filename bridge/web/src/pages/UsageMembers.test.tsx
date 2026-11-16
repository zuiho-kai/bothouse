import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import UsageMembers from './UsageMembers';
import { getUsage } from '@/api/usage';
vi.mock('@/api/usage', () => ({ getUsage: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
it('ranks members, changes cost sorting and requests the selected member detail', async () => {
 const base = { hour: -1, input_tokens: 1, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, responses: 1, unknown_usage_responses: 0, unpriced_responses: 0 };
 vi.mocked(getUsage).mockImplementation(async group => ({ from:'2026-11-17',to:'2026-11-17',timezone:'UTC',items: group === 'members' ? [
  {...base,member:'discord:1',total_tokens:100,estimated_cost:1},
  {...base,member:'feishu:1',total_tokens:50,estimated_cost:2},
  {...base,member:'system',total_tokens:50,estimated_cost:0},
 ] : [{...base,date:'2026-11-17',total_tokens:50,estimated_cost:2}] }));
 const container=document.createElement('div');document.body.appendChild(container);const root=createRoot(container);
 await act(async()=>root.render(<UsageMembers from="2026-11-17" to="2026-11-17" role="" model="" revision={0}/>));
 expect(container.querySelector('tbody button')?.textContent).toBe('discord:1');
 expect(container.textContent).toContain('50.0%');
 await act(async()=>{const select=container.querySelector('select')!;select.value='cost';select.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(container.querySelector('tbody button')?.textContent).toBe('feishu:1');
 await act(async()=>(container.querySelector('tbody button') as HTMLButtonElement).click());
 expect(getUsage).toHaveBeenLastCalledWith('daily',expect.objectContaining({member:'feishu:1'}));
 expect(container.textContent).toContain('2026-11-17');
 act(()=>root.unmount());container.remove();
});
