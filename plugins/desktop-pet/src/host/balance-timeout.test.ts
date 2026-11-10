import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { queryBalance, registerBalanceProvider, type BalanceResult, type BalanceSuccess } from './balance/index.ts';

const success = (provider: string): BalanceSuccess => ({
  ok: true,
  provider,
  shape: 'points',
  data: { unit: '积分', total: '800' },
});

test('a pending external balance query times out and the next refresh can succeed', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const dispose = registerBalanceProvider({
    id: 'timeout-recovery',
    fetch: ({ provider }) => {
      calls++;
      return calls === 1 ? new Promise(() => {}) : Promise.resolve(success(provider));
    },
  });
  t.after(dispose);
  const results: BalanceResult[] = [];
  const first = queryBalance('timeout-recovery', async () => undefined).then((result) => results.push(result));
  t.mock.timers.tick(19_999);
  await setImmediate();
  assert.equal(results.length, 0, 'a query may still complete before its deadline');
  t.mock.timers.tick(1);
  await setImmediate();
  assert.equal(results.length, 1, 'a hung query must release the awaiting refresh');
  await first;
  assert.deepEqual(results[0], {
    ok: false,
    provider: 'timeout-recovery',
    reason: 'fetch-error',
    message: '余额查询超时（20 秒），请稍后重试',
  });
  assert.deepEqual(await queryBalance('timeout-recovery', async () => undefined), success('timeout-recovery'));
  assert.equal(calls, 2);
});

for (const late of ['resolve', 'reject'] as const) {
  test(`an external query's late ${late} cannot replace its timeout result`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const id = `timeout-late-${late}`;
    let resolve!: (value: BalanceSuccess) => void;
    let reject!: (error: Error) => void;
    const dispose = registerBalanceProvider({
      id,
      fetch: () =>
        new Promise<BalanceSuccess>((res, rej) => {
          resolve = res;
          reject = rej;
        }),
    });
    t.after(dispose);
    const results: BalanceResult[] = [];
    const pending = queryBalance(id, async () => undefined).then((result) => results.push(result));
    t.mock.timers.tick(20_000);
    await setImmediate();
    assert.equal(results.length, 1);
    await pending;
    assert.equal(results[0].ok, false);
    if (late === 'resolve') resolve(success(id));
    else reject(new Error('late provider failure'));
    await setImmediate();
    assert.equal(results.length, 1);
    assert.equal(results[0].ok, false);
  });
}

test('external query synchronous failures retain their existing fetch-error result', async (t) => {
  const dispose = registerBalanceProvider({
    id: 'timeout-sync-error',
    fetch() {
      throw new Error('provider failed immediately');
    },
  });
  t.after(dispose);
  assert.deepEqual(await queryBalance('timeout-sync-error', async () => undefined), {
    ok: false,
    provider: 'timeout-sync-error',
    reason: 'fetch-error',
    message: 'provider failed immediately',
  });
});
