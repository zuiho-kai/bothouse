/**
 * host 工具详情映射的单测 —— 钉住五件事：
 *   ① 文案是数据表里的候选句（随机挑一句），且必须带具体对象名；
 *   ② 命令按「命令 / 命令+子命令」查表；没有语义的命令（npm / python / node）走兜底；
 *   ③ 复合命令（`;` `|` `&&` 换行）一律返回 null，让前端回落配置文案；
 *   ④ 安全边界：命令参数（含凭据）不上屏、超大 arguments 不解析、非法 JSON 不抛、
 *      原型链上的名字不命中表；
 *   ⑤ 不该出现的工具（todo_write / ask_user_question / goal 系）→ null。
 *
 * 跑法：node --experimental-strip-types --test src/host/tool-detail.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { toolDetailFromEvent } from './tool-detail.ts';
import { TASK_TEXT_MAX } from './work-status.ts';

/** 造一个 tool/call 事件；args 传对象会被序列化成 JSON 字符串（与宿主事件形状一致） */
function call(name: string, args?: Record<string, unknown>): Parameters<typeof toolDetailFromEvent>[0] {
  return { data: { name, arguments: args === undefined ? undefined : JSON.stringify(args) } };
}

/** 文案是随机挑的，断言只能落在候选集合内 */
function oneOf(actual: string | null, expected: readonly string[]): void {
  assert.ok(actual !== null && expected.includes(actual), `得到 ${String(actual)}，不在 [${expected.join(' | ')}] 里`);
}

describe('工具文案 —— 每工具 3 句候选，且带具体对象', () => {
  test('read：文件名必须出现在句子里', () => {
    oneOf(toolDetailFromEvent(call('read', { file_path: 'a.ts' })), [
      '翻翻 a.ts 看看嘛',
      'a.ts 里面写了啥呢',
      '我先瞅瞅 a.ts 哈',
    ]);
  });

  test('read_image：与 read 用不同的文案（图片 ≠ 文本）', () => {
    oneOf(toolDetailFromEvent(call('read_image', { file_path: 'logo.png' })), [
      '这 logo.png 长啥样呀',
      '让我瞧瞧 logo.png 呗',
      'logo.png 是张什么图呢',
    ]);
  });

  test('edit：长路径压成文件名', () => {
    oneOf(toolDetailFromEvent(call('edit', { file_path: 'D:\\Projects\\Web\\pet\\dsh-pet\\src\\host\\index.ts' })), [
      'index.ts 得改改啦',
      '我来动动 index.ts 哦',
      'index.ts 这里要修一下',
    ]);
  });

  test('write / glob / grep / present / skill / web_search / web_fetch 都能出句', () => {
    oneOf(toolDetailFromEvent(call('write', { file_path: 'notes.md' })), [
      '写点东西到 notes.md',
      'notes.md 马上写出来',
      '给 notes.md 添点料',
    ]);
    oneOf(toolDetailFromEvent(call('glob', { pattern: '*.ts' })), [
      '*.ts 都躲哪儿了呢',
      '找找 *.ts 在不在',
      '*.ts 藏在哪个角落呀',
    ]);
    oneOf(toolDetailFromEvent(call('grep', { pattern: 'TODO' })), [
      'TODO 藏哪儿了呢',
      '搜搜 TODO 在哪',
      '哪儿有 TODO 呀',
    ]);
    oneOf(toolDetailFromEvent(call('present', { files: [{ path: 'a.png' }] })), [
      '给你看 a.png 哦',
      'a.png 拿来给你瞧瞧',
      '喏，a.png 在这儿',
    ]);
    oneOf(toolDetailFromEvent(call('skill', { name: 'git-commit' })), [
      '学个新本事 git-commit',
      'git-commit 这招得记住',
      '把 git-commit 学起来',
    ]);
    oneOf(toolDetailFromEvent(call('web_search', { queries: ['electron'] })), [
      '我去查查 electron',
      'electron 得搜搜才知道',
      '上网问问 electron 吧',
    ]);
    oneOf(toolDetailFromEvent(call('web_fetch', { url: 'https://github.com/x/y' })), [
      '去 github.com 瞅瞅有啥',
      'github.com 这页我翻翻',
      '看看 github.com 上写了啥',
    ]);
  });

  test('workflow：整句不带对象也能出（不需要目标）', () => {
    oneOf(toolDetailFromEvent(call('workflow')), ['把活排个序，开工咯', '几件事一起安排上', '按顺序一件件来']);
  });

  test('拿不到目标 → null（不覆盖已有文案，也不吐半句话）', () => {
    assert.equal(toolDetailFromEvent(call('read')), null);
    assert.equal(toolDetailFromEvent(call('edit', {})), null);
  });
});

describe('pwsh —— 命令 / 子命令查表', () => {
  test('有语义的命令：cd / git 走表', () => {
    oneOf(toolDetailFromEvent(call('pwsh', { command: 'cd D:\\Projects\\Web\\pet' })), [
      '先把位置挪一挪',
      '切到那个目录去',
      '挪个地方继续干活',
    ]);
    oneOf(toolDetailFromEvent(call('pwsh', { command: 'git status -s' })), [
      '看看现在改了些什么',
      '查查工作区干不干净',
      '目前是啥状况呢',
    ]);
    oneOf(toolDetailFromEvent(call('pwsh', { command: 'git push origin main' })), [
      '该推上去了吧，我来',
      '推送一下，交给我',
      '该让远端知道了',
    ]);
    oneOf(toolDetailFromEvent(call('pwsh', { command: 'git log --oneline -3' })), [
      '让我康康你的提交历史',
      '翻翻最近都提交了啥',
      '看看这些天干了什么',
    ]);
  });

  test('git 没命中子命令 → 用通用 git 文案', () => {
    oneOf(toolDetailFromEvent(call('pwsh', { command: 'git frobnicate' })), [
      '折腾折腾 git 仓库',
      '跟 git 打个交道',
      'git 这边动一动',
    ]);
  });

  test('没有语义的命令（npm / python / node）→ 兜底，带上命令名', () => {
    oneOf(toolDetailFromEvent(call('pwsh', { command: 'npm test' })), [
      '跑一下 npm 咯',
      'npm 跑起来了',
      '让 npm 干点活',
    ]);
    oneOf(toolDetailFromEvent(call('pwsh', { command: 'python train.py --epochs 10' })), [
      '跑一下 python 咯',
      'python 跑起来了',
      '让 python 干点活',
    ]);
    oneOf(toolDetailFromEvent(call('pwsh', { command: 'node script.js' })), [
      '跑一下 node 咯',
      'node 跑起来了',
      '让 node 干点活',
    ]);
  });
});

describe('复合命令 —— 一律不猜，回落配置文案', () => {
  test('分号 / 管道 / && / 换行 都返回 null', () => {
    assert.equal(toolDetailFromEvent(call('pwsh', { command: 'cd D:\\x; npx prettier --write a.ts' })), null);
    assert.equal(toolDetailFromEvent(call('pwsh', { command: 'git status | head -5' })), null);
    assert.equal(toolDetailFromEvent(call('pwsh', { command: 'cd D:\\x && npm test' })), null);
    assert.equal(toolDetailFromEvent(call('pwsh', { command: 'npm test\nnpm run lint' })), null);
    assert.equal(toolDetailFromEvent(call('pwsh', { command: 'echo a || echo b' })), null);
  });

  test('现场那条以字符串字面量开头的复合命令 → null', () => {
    const real =
      '"== 18016 监听 =="; (Get-NetTCPConnection -LocalPort 18016 -State Listen -ErrorAction SilentlyContinue | Measure-Object).Count';
    assert.equal(toolDetailFromEvent(call('pwsh', { command: real })), null);
  });
});

describe('安全与健壮性', () => {
  test('命令参数（含凭据）绝不上屏', () => {
    const detail = toolDetailFromEvent(
      call('pwsh', { command: 'curl -H "Authorization: Bearer sk-live-secret" https://api.example.com' }),
    );
    oneOf(detail, ['去问问接口有没有人', '敲敲门看看通不通', '请求一下那个地址']);
    assert.equal(String(detail).includes('sk-live-secret'), false, '凭据不上屏');
    assert.equal(String(detail).includes('api.example.com'), false, '参数不上屏');
  });

  test('事件形状非法 / 非法 JSON / 非对象 → null，不抛', () => {
    assert.equal(toolDetailFromEvent(null), null);
    assert.equal(toolDetailFromEvent({}), null);
    assert.equal(toolDetailFromEvent({ data: { name: 123 } }), null);
    assert.equal(toolDetailFromEvent({ data: { name: 'edit', arguments: '{not json' } }), null);
    assert.equal(toolDetailFromEvent({ data: { name: 'edit', arguments: '[]' } }), null);
  });

  test('原型链上的名字不命中表：constructor / toString / __proto__ 按未知处理', () => {
    for (const name of ['constructor', 'toString', '__proto__', 'valueOf']) {
      assert.equal(toolDetailFromEvent(call(name)), '这工具是干嘛的', name);
    }
    oneOf(toolDetailFromEvent(call('pwsh', { command: 'constructor' })), [
      '跑一下 constructor 咯',
      'constructor 跑起来了',
      '让 constructor 干点活',
    ]);
    // 命令表同理：`git constructor` 命中通用 git 文案，不把 `constructor` 当子命令
    oneOf(toolDetailFromEvent(call('pwsh', { command: 'git constructor' })), [
      '折腾折腾 git 仓库',
      '跟 git 打个交道',
      'git 这边动一动',
    ]);
  });

  test('arguments 直接是对象（非字符串）也认', () => {
    oneOf(toolDetailFromEvent({ data: { name: 'read', arguments: { file_path: 'x/y.ts' } } }), [
      '翻翻 x/y.ts 看看嘛',
      'x/y.ts 里面写了啥呢',
      '我先瞅瞅 x/y.ts 哈',
    ]);
  });

  test('超大 arguments（write 带整个文件内容）不解析 → null', () => {
    const huge = JSON.stringify({ file_path: 'a.ts', content: 'x'.repeat(70 * 1024) });
    assert.equal(toolDetailFromEvent({ data: { name: 'write', arguments: huge } }), null);
  });

  test('输出永不超过 TASK_TEXT_MAX + 1（省略号）', () => {
    const cases = [
      call('read', { file_path: 'x'.repeat(200) }),
      call('web_search', { queries: ['长'.repeat(200)] }),
      call('frobnicate'),
      call('pwsh', { command: 'a'.repeat(200) }),
    ];
    for (const event of cases) {
      const detail = toolDetailFromEvent(event);
      assert.notEqual(detail, null);
      assert.ok(Array.from(String(detail)).length <= TASK_TEXT_MAX + 1, `超长：${String(detail)}`);
    }
  });
});

describe('目标过长 —— 换一句不带名字的氛围兜底', () => {
  test('grep 的正则太长（现场截图那条）→ 不塞进句子', () => {
    assert.equal(
      toolDetailFromEvent(call('grep', { pattern: 'WORK_STATE_GAP_MS|busyFlip|workFlushTimer' })),
      '到处翻翻看',
    );
  });

  test('文件名太长（超过 20 码点）→ 该工具的兜底句', () => {
    assert.equal(toolDetailFromEvent(call('read', { file_path: 'work-status-lifecycle.test.ts' })), '翻翻代码看看');
    assert.equal(
      toolDetailFromEvent(call('read_image', { file_path: 'some-very-long-image-name.png' })),
      '看看这张图是啥',
    );
  });

  test('边界：20 码点保留，21 码点回落', () => {
    const twenty = 'a'.repeat(20);
    oneOf(toolDetailFromEvent(call('read', { file_path: twenty })), [
      `翻翻 ${twenty} 看看嘛`,
      `${twenty} 里面写了啥呢`,
      `我先瞅瞅 ${twenty} 哈`,
    ]);
    assert.equal(toolDetailFromEvent(call('read', { file_path: 'a'.repeat(21) })), '翻翻代码看看');
  });

  test('命令名太长 → 不带名字的兜底', () => {
    assert.equal(toolDetailFromEvent(call('pwsh', { command: 'Get-NetTCPConnectionDetail' })), '跑一个命令咯');
  });

  test('短命令名仍然上屏（npm / python 这种有信息量）', () => {
    oneOf(toolDetailFromEvent(call('pwsh', { command: 'npm test' })), [
      '跑一下 npm 咯',
      'npm 跑起来了',
      '让 npm 干点活',
    ]);
  });
});

describe('兜底与跳过', () => {
  test('未知工具 → 一句氛围话，不报工具名', () => {
    assert.equal(toolDetailFromEvent(call('frobnicate')), '这工具是干嘛的');
  });

  test('语义已由别处表达的工具 → null（不许盖掉更具体的文案）', () => {
    for (const name of [
      'todo_write',
      'ask_user_question',
      'update_goal',
      'get_goal',
      'create_goal',
      'exit_plan_mode',
    ]) {
      assert.equal(toolDetailFromEvent(call(name, { action: 'complete' })), null, name);
    }
  });
});
