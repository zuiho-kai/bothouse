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

test('mentions: inline code spans call nobody, unlike a bare @ in text (#237 rework)', () => {
  assert.deepEqual(found('看 `@肥鱼` 这个'), []);
  assert.deepEqual(found('`@肥鱼` 和 @G哥 看下'), ['gge']);
  assert.deepEqual(found('``@肥鱼`` 和 ``@G哥``'), []);
  assert.deepEqual(found('`a` 和 @肥鱼'), ['dsh']);
  // an unclosed backtick is literal text, not code
  assert.deepEqual(found('@肥鱼 后跟 `未闭合的反引号'), ['dsh']);
  // adjacent runs of different lengths do not pair up
  assert.deepEqual(found('`@肥鱼``x 不是行内代码'), ['dsh']);
  // the text is kept verbatim, so rewriting and display still see every character
  assert.equal(split('看 `@肥鱼` 这个', members).map(([s]) => s).join(''), '看 `@肥鱼` 这个');
  assert.equal(forDisplay('看 `@肥鱼` 这个', members), '看 `@肥鱼` 这个');
});

test('mentions: an inline code span cannot cross a blank line (#245)', () => {
  // the reported case: one pair of backticks around a name, a blank line, another name. The blank
  // line ends the paragraph, so the renderer never makes this a code span — the page shows both
  // names in plain text, so both are calls, and the backend must agree (it used to call nobody).
  assert.deepEqual(found('`@肥鱼\n\n@G哥`'), ['dsh', 'gge']);
  // a blank line padded with spaces or a tab is still a blank line
  assert.deepEqual(found('`@肥鱼\n \n@G哥`'), ['dsh', 'gge']);
  assert.deepEqual(found('`@肥鱼\n\t\n@G哥`'), ['dsh', 'gge']);
  // a single line break is not a blank line: still one span, so still nobody
  assert.deepEqual(found('`@肥鱼\n@G哥`'), []);
  // the text is not rewritten either way
  assert.equal(split('`@肥鱼\n\n@G哥`', members).map(([s]) => s).join(''), '`@肥鱼\n\n@G哥`');
  assert.equal(forDisplay('`@肥鱼\n\n@G哥`', members), '`@肥鱼\n\n@G哥`');
  // a span closed before the blank line still counts, names after it are text
  assert.deepEqual(found('`a`\n\n@肥鱼 看下'), ['dsh']);
  // the opener left literal, an empty second run right after the blank line pairs nothing
  assert.deepEqual(found('`@肥鱼\n\n` 之后 @G哥'), ['dsh', 'gge']);
  // later backtick runs still pair with each other after the rejected opener
  assert.deepEqual(found('`@肥鱼\n\n@G哥` 和 ``@阿柚子``'), ['dsh', 'gge']);
});

test('mentions: CRLF is one line ending, not a blank line (#246)', () => {
  for (const ending of ['\n', '\r\n', '\r']) {
    const single = '`@肥鱼' + ending + '@G哥`';
    assert.deepEqual(found(single), []);
    assert.equal(split(single, members).map(([s]) => s).join(''), single);
    assert.equal(forDisplay(single, members), single);
    for (const padding of ['', ' ', '\t']) {
      const blank = '`@肥鱼' + ending + padding + ending + '@G哥`';
      assert.deepEqual(found(blank), ['dsh', 'gge']);
      assert.equal(split(blank, members).map(([s]) => s).join(''), blank);
      assert.equal(forDisplay(blank, members), blank);
    }
  }
});

test('mentions: an inline code span cannot cross a block that ends the paragraph (#259)', () => {
  // the reported case: one pair of backticks around a name, a line that opens a block, another
  // name. The block ends the paragraph, so the renderer never makes this a code span — the page
  // shows both names in plain text, so both are calls, and the backend must agree (it used to
  // call nobody while the page coloured two).
  const blocks = [
    '# 标题', '## 二级', '###### 六级', // headings
    '- 列表', '* 列表', '+ 列表', '1. 一', '1) 一', // list items
    '> 引用', '>引用', // quotes
    '---', '***', '___', '- - -', // thematic breaks
    '===', // setext underline
    '<div>x</div>', '<pre>', '<!-- c -->', '<?php', '<!DOCTYPE html>', // HTML blocks
  ];
  for (const block of blocks) {
    const text = '`@肥鱼\n' + block + '\n@G哥`';
    assert.deepEqual(found(text), ['dsh', 'gge'], block);
    // the text is not rewritten: both names stay where the user typed them
    assert.equal(split(text, members).map(([s]) => s).join(''), text, block);
    assert.equal(forDisplay(text, members), text, block);
  }
  // lines that do not open a block keep the span, so nobody is called
  for (const line of ['普通一行', 'a # b', 'a > b', '1.x', '<span>x</span>', '    # 四空格', '-项目']) {
    assert.deepEqual(found('`@肥鱼\n' + line + '\n@G哥`'), [], line);
  }
  // a fence is not in this family: the text before ` ``` ` is plain, the fenced body is skipped
  assert.deepEqual(found('`@肥鱼\n```\n@G哥`'), ['dsh']);
  // a block inside a quote or a list item ends the paragraph there too
  assert.deepEqual(found('> `@肥鱼\n> # 标题\n> @G哥`'), ['dsh', 'gge']);
  assert.deepEqual(found('- `@肥鱼\n  - 列表\n  @G哥`'), ['dsh', 'gge']);
  // and the span still holds across a plain line in the same container
  assert.deepEqual(found('> `@肥鱼\n> 普通一行\n> @G哥`'), []);
  assert.deepEqual(found('- `@肥鱼\n  普通一行\n  @G哥`'), []);
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

test('mentions: a hidden footnote definition calls nobody (#271)', () => {
  // #259 fixed the code-span rule and this one regressed: the page hides a footnote definition
  // whose label nobody calls, so an @ inside its body is not on the page at all, while the
  // backend read the body and woke the member. The reported text, with each block line family.
  const repro = '[^1]: 注\n`@肥鱼\n# 标题\n`';
  assert.deepEqual(found(repro), []);
  for (const block of ['# 标题', '- 列表', '> 引用', '---', '<div>x</div>']) {
    const text = '[^1]: 注\n`@肥鱼\n' + block + '\n`';
    assert.deepEqual(found(text), [], block);
    // and the text is still not rewritten: split() keeps every character
    assert.equal(split(text, members).map(([s]) => s).join(''), text, block);
  }
  // a body without a block line is hidden all the same
  assert.deepEqual(found('[^1]: 注\n@肥鱼 看下'), []);
  assert.deepEqual(found('[^1]: 注\n    @肥鱼 代码'), []);
  assert.deepEqual(found('  [^1]: 注\n@肥鱼'), []);
  // CRLF and a list item holding the definition behave the same
  assert.deepEqual(found('[^1]: 注\r\n@肥鱼\r\n# 标题'), []);
  assert.deepEqual(found('- [^2]: 注\n  @G哥'), []);
});

test('mentions: a footnote body is not hidden when something still refers to it (#271)', () => {
  // the reverse of the rule above: text after the definition is a paragraph of its own, and a
  // definition something refers to is shown on the page, so its @ is a call. Without these the
  // rule could silently turn into "any `[^` mutes the message".
  assert.deepEqual(found('[^1]: 注 @肥鱼\n\n见 [^1]'), ['dsh']);
  assert.deepEqual(found('[^1]: 注\n@肥鱼\n\n见 [^1]'), ['dsh']);
  assert.deepEqual(found('[^A]: 注 @肥鱼\n\n见 [^a]'), ['dsh']);
  // nothing that follows a definition is muted: a new paragraph, heading, list item or quote is
  // normal text again
  assert.deepEqual(found('[^1]: 注\n\n@肥鱼 看下'), ['dsh']);
  assert.deepEqual(found('[^1]: 注\n# 标题\n@肥鱼'), ['dsh']);
  assert.deepEqual(found('[^1]: 注\n- 项\n\n@肥鱼 看下'), ['dsh']);
  assert.deepEqual(found('[^1]: 注\n> 引用\n\n@G哥 看下'), ['gge']);
  // a `[^` that is not a definition mutes nothing
  assert.deepEqual(found('[@肥鱼 看下'), ['dsh']);
  assert.deepEqual(found('`@肥鱼\n# 标题\n` 和 @G哥'), ['dsh', 'gge']);
  assert.deepEqual(found('    [^1]: 注 @肥鱼'), ['dsh']); // four columns is an indented code block
});

test('mentions: a repeated footnote label keeps only its first definition (#271)', () => {
  // the renderer shows the first definition of a label and drops the rest, so the second one is
  // hidden even when the label is called; only the label's first body can stay visible
  assert.deepEqual(found('[^1]: 甲 @肥鱼\n\n[^1]: 乙 @G哥'), []);
  assert.deepEqual(found('[^1]: 甲 @肥鱼\n\n[^1]: 乙 @G哥\n\n见 [^1]'), ['dsh']);
  // a reference inside another hidden body counts for nothing
  assert.deepEqual(found('[^1]: 注\n看 [^2]\n\n[^2]: 注 @肥鱼'), []);
  assert.deepEqual(found('[^1]: 见 [^1] @肥鱼'), []); // a self-reference stays hidden
  // a reference inside a fence, a code span or a comment does not count either
  assert.deepEqual(found('[^1]: 注 @肥鱼\n\n```\n[^1]\n```'), []);
  assert.deepEqual(found('[^1]: 注 @肥鱼\n\n`[^1]`'), []);
  assert.deepEqual(found('[^1]: 注 @肥鱼\n\n<!-- [^1] -->'), []);
});

test('mentions: a big text stays linear (#271)', () => {
  // #271: splitLines() ran inside endsParagraph() per backtick pair, so mentions() was
  // O(runs x lines). Medians on this machine before the fix: 3000 spans 42 ms, 16000 groups
  // 2664 ms, 131071 characters one backtick per line 58795 ms — the last inside hub.post's
  // store.transaction(), blocking every other write on the hub. After the fix: 6 ms, 166 ms,
  // 16 ms. The bound below is ~100x the measured 16 ms and still far under the 59 s the old
  // loop took, so it only fails if the quadratic shape comes back.
  const onePerLine = ('`\n'.repeat(65536)).slice(0, 131071);
  const started = process.hrtime.bigint();
  assert.deepEqual(found(onePerLine), []);
  const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(elapsed < 2000, `one backtick per line took ${elapsed.toFixed(0)} ms`);
  // the same shape with a name on every line calls the name once: still linear, no truncation
  const named = ('`@肥鱼\n'.repeat(32767)).slice(0, 131071);
  assert.deepEqual(found(named), ['dsh']);
});
