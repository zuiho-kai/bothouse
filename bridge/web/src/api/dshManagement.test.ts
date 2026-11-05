import { afterEach, expect, it, vi } from 'vitest';
import { deleteDSHMember, getDSHCliOptions, updateDSHMember } from './dsh';

afterEach(() => vi.unstubAllGlobals());
it('uses the management envelope and encoded stable IDs for member actions', async () => {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({ status: 200, json: async () => ({ ok: true, data: { id: 'a/b' } }) }));
  vi.stubGlobal('fetch', fetch);
  await updateDSHMember('a/b', { model: null }); await deleteDSHMember('a/b');
  await getDSHCliOptions({ cli: 'codex', memberId: 'a/b', model: 'm1' });
  expect(fetch.mock.calls[0][0]).toContain('/api/v1/dsh/members/a%2Fb');
  expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'PATCH', body: '{"model":null}' });
  expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'DELETE' });
  expect(fetch.mock.calls[2][1]).toMatchObject({ method: 'POST', body: '{"cli":"codex","memberId":"a/b","model":"m1"}' });
});
