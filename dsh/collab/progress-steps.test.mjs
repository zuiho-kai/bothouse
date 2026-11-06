import test from 'node:test';
import assert from 'node:assert/strict';
import { TurnProgress } from './dsh-member.mjs';
import { progressCard, PROGRESS_PREFIX } from './cloudweb.mjs';

test('progress steps: empty tool arguments survive gateway detail, brief and chips', () => {
  for (const state of ['running', 'completed']) {
    const body = progressCard(PROGRESS_PREFIX + JSON.stringify({ agent: 'ACP', state, steps: 2, items: [
      { kind: 'tool_use', tool: 'bash', text: '' },
      { kind: 'tool_result', tool: 'bash', text: '', status: 'completed' },
      { kind: 'tool_use', tool: 'read', text: '' },
    ] }));
    const card = JSON.parse(body.card);
    assert.equal(card.steps, 2);
    assert.match(body.text, /第 2 步/);
    assert.match(body.text, /🔧 bash/);
    assert.match(card.brief, /✅ bash · 成功/);
    assert.equal(card.chips.length, 2);
    assert.equal(card.chips[0].state, 'ok');
    console.log(state, JSON.stringify({ text: body.text, brief: card.brief, chips: card.chips }));
  }
});

test('progress steps: native ACP calls count once and duplicate results do not add steps', async () => {
  const rows = [];
  const hub = {
    post: (_r, row) => { rows.push(row); return { message: { id: 1 } }; },
    edit: (_id, _kind, _author, text, card) => { rows.push({ text, card }); },
  };
  const p = new TurnProgress(hub, 1, { id: 'acp', name: 'ACP' }, 1);
  p.call('call-1', 'bash', '');
  p.call('call-1', 'bash', '');
  p.result('call-1', false);
  p.result('call-1', false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(JSON.parse(rows.at(-1).card).steps, 1);
  p.call('call-2', 'read', '');
  p.result('call-2', true);
  p.end('completed');
  const card = JSON.parse(rows.at(-1).card);
  assert.equal(card.steps, 2);
  assert.equal(card.state, 'completed');
  assert.deepEqual(card.chips.map(c => [c.tool, c.state]), [['bash', 'ok'], ['read', 'failed']]);
  p.result('call-2', true);
  assert.equal(JSON.parse(rows.at(-1).card).steps, 2);
});
