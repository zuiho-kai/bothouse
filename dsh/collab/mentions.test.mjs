// #237: the backend's "@ someone" rule must be the same rule the channel page colours with
// (dsh/packages/client-ui-discord/src/client/mention-highlight.tsx buildMentionMatcher), so a
// message colours exactly the members it calls. Two sides drifting is the bug: '联系 xx@dsh.ai'
// and '@dsh2' stayed uncoloured but still woke dsh, and a ``` fence coloured @ on the page while
// the backend skipped it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { forDisplay, forMember, mentions, split, withoutLeadingMentions } from './mentions.mjs';

const members = [
  { id: 'dsh', name: '肥鱼' },
  { id: 'gge', name: 'G哥' },
  { id: 'yuzi_long', name: '阿柚子' },
  { id: 'yuzi', name: '阿柚' },
  { id: 'cat', name: 'cat', mentionId: '1001' },
];
const found = text => [...mentions(text, members)].sort();

test('mentions: an @ inside an email address calls nobody (page does not colour it)', () => {
  assert.deepEqual(found('联系 xx@dsh.ai'), []);
  assert.deepEqual(found('write to user@cat.com'), []);
  assert.deepEqual(found('user@肥鱼.com'), []);
  // still a call once the @ opens a word
  assert.deepEqual(found('邮箱 xx@dsh.ai 或 @dsh'), ['dsh']);
});

test('mentions: a longer ascii word after @name is a different name (page does not colour it)', () => {
  assert.deepEqual(found('@dsh2 你好'), []);
  assert.deepEqual(found('@dsh_lab 你好'), []);
  assert.deepEqual(found('@dsh 你好'), ['dsh']);
  // a dot is not a word character, so '@dsh.ai' is still dsh on both sides
  assert.deepEqual(found('@dsh.ai'), ['dsh']);
});

test('mentions: a Chinese name may still be followed directly by characters', () => {
  assert.deepEqual(found('@肥鱼你好'), ['dsh']);
  assert.deepEqual(found('@G哥在吗'), ['gge']);
  assert.deepEqual(found('「@肥鱼」看下'), ['dsh']);
});

test('mentions: ``` fences call nobody, outside the fence still calls', () => {
  assert.deepEqual(found('```\n@G哥\n```'), []);
  assert.deepEqual(found('```js\n@肥鱼\n```'), []);
  assert.deepEqual(found('```\n@G哥\n```\n@肥鱼 看下'), ['dsh']);
  // the fence text itself is kept verbatim by split()
  assert.equal(split('```\n@G哥\n```', members).map(([s]) => s).join(''), '```\n@G哥\n```');
});

test('mentions: <@id> and <@!id> are calls, and the longest alias wins', () => {
  assert.deepEqual(found('<@dsh> 你好'), ['dsh']);
  assert.deepEqual(found('<@!dsh> 你好'), ['dsh']);
  assert.deepEqual(found('来自 <@1001> 的消息'), ['cat']);
  assert.deepEqual(found('@阿柚子 和 @阿柚'), ['yuzi', 'yuzi_long']);
  assert.deepEqual(split('@阿柚子', members).filter(([, id]) => id), [['@阿柚子', 'yuzi_long']]);
});

test('mentions: forMember/forDisplay/withoutLeadingMentions use the same rule', () => {
  const dsh = members[0];
  // an email is plain text now, so it is not stripped as an opening mention
  assert.equal(withoutLeadingMentions('xx@dsh.ai 看下', members), 'xx@dsh.ai 看下');
  assert.equal(withoutLeadingMentions('@肥鱼 看下', members), '看下');
  assert.equal(forMember('xx@dsh.ai 看下 @G哥', dsh, members), 'xx@dsh.ai 看下 @G哥');
  assert.equal(forDisplay('xx@dsh.ai', members), 'xx@dsh.ai');
  assert.equal(forDisplay('<@1001> 你好', members), '@cat 你好');
});
