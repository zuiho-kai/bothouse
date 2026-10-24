// 主路回归的浏览器一侧：在频道页对主角色说一句 → 主角色 @ 派队友 → 队友交回 → 主角色汇总，
// 全部回到同一个频道；桌面（1440x900）和手机（390x844）各截一张。
// 输入（环境变量）：LOGIN_URL（dsh 打印的带 token 登录地址）、OUT（截图和结果目录）、
//   TIMEOUT_MS（等汇总的上限，默认 60000；本机实测整条链 2 秒内走完）。
// 结果：OUT/result.json；退出码 0=PASS，1=FAIL。
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const { LOGIN_URL, OUT } = process.env;
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 60000);
if (!LOGIN_URL || !OUT) throw new Error('缺环境变量 LOGIN_URL 或 OUT');
const base = new URL(LOGIN_URL).origin;

// 和 fake_agent.py 的固定台词对应。
const ASK = '@橘 派活给队员';
const steps = [
  { name: '主角色@派队友', author: 'ju', match: (t) => /^@龙\s/.test(t) && t.includes('子任务 X') },
  { name: '队友交回', author: 'dev', match: (t) => /^@橘\s/.test(t) && t.includes('子任务 X 做完了') },
  { name: '主角色汇总', author: 'ju', match: (t) => t.includes('收到队友交回的结果 42') },
];

const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

const browser = await chromium.launch();
const errors = [];
let messages = [];
try {
  // 桌面：登录 → 进频道 → 在输入框里说一句。
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await desk.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(LOGIN_URL, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '频道', exact: true }).first().click();
  // cc-connect 刚起，两个 bot 连上频道页要一两秒。
  let state = {};
  for (let i = 0; i < 60; i++) {
    state = await (await desk.request.get(`${base}/collab/api/state`)).json();
    if (['ju', 'dev'].every((id) => state.members?.find((m) => m.id === id)?.online)) break;
    await page.waitForTimeout(500);
  }
  const general = state.rooms?.find((r) => r.kind === 'chat' && !r.parent_id);
  check('频道页有主角色和队友在线', state.effective_lead_id === 'ju' &&
    ['ju', 'dev'].every((id) => state.members?.find((m) => m.id === id)?.online),
  `lead=${state.effective_lead_id} members=${(state.members || []).map((m) => `${m.id}:${m.online}`).join(',')}`);
  if (!general) throw new Error('没有聊天频道');
  const before = (await (await desk.request.get(`${base}/collab/api/rooms/${general.id}/messages?limit=200`)).json()).messages ?? [];
  const lastId = before.reduce((a, m) => Math.max(a, m.id), 0);

  // 频道页的输入框（占位文字「发消息到 #频道名…」）；不能取随便哪个 textarea，频道页没渲染完时那是 dsh 会话输入框。
  const box = page.getByPlaceholder(`发消息到 #${general.name}`, { exact: false });
  await box.waitFor({ timeout: 15000 });
  await box.click();
  await box.fill(ASK);
  await box.press('Enter');

  // 等汇总出现在同一频道（接口轮询，页面上再核一次可见）。
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const all = (await (await desk.request.get(`${base}/collab/api/rooms/${general.id}/messages?limit=200`)).json()).messages ?? [];
    messages = all.filter((m) => m.id > lastId);
    if (messages.some((m) => m.author === 'ju' && steps[2].match(m.text || '')) || Date.now() > deadline) break;
    await page.waitForTimeout(500);
  }
  const ask = messages.find((m) => m.author_kind === 'user' && (m.text || '').trim() === ASK);
  const sendErr = ask ? '' : await page.getByText(/发送失败/).first().innerText({ timeout: 1000 }).catch(() => '');
  check('页面输入框发出的话落在频道里', ask, ask ? `#${ask.id}` : `新消息 ${messages.length} 条 ${sendErr}`.trim());
  let prev = ask?.id ?? Infinity;
  for (const s of steps) {
    const m = messages.find((x) => x.id > prev && x.author === s.author && s.match(x.text || ''));
    check(s.name, m, m ? `#${m.id} ${m.name}：${(m.text || '').split('\n')[0]}` : '没等到');
    prev = m ? m.id : Infinity;
  }
  // 汇总在页面上看得到（回到同一页）。
  const sumVisible = await page.getByText('收到队友交回的结果 42').first().waitFor({ timeout: 10000 }).then(() => true, () => false);
  check('桌面频道页上看得到汇总', sumVisible);
  await page.screenshot({ path: join(OUT, 'mainpath-desktop.png') });
  await desk.close();

  // 手机 390x844：重新登录进频道，同一频道里看得到整条对话。
  const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'zh-CN' });
  const mp = await mob.newPage();
  mp.on('pageerror', (e) => errors.push(String(e)));
  await mp.goto(LOGIN_URL, { waitUntil: 'networkidle' });
  await mp.getByRole('button', { name: '频道', exact: true }).first().click();
  const mobVisible = await mp.getByText('收到队友交回的结果 42').first().waitFor({ timeout: 10000 }).then(() => true, () => false);
  check('手机 390x844 频道页上看得到汇总', mobVisible);
  await mp.screenshot({ path: join(OUT, 'mainpath-mobile-390x844.png') });
  await mob.close();
} catch (e) {
  check('脚本跑完', false, String(e).split('\n')[0]);
}
await browser.close();
// 前端未捕获异常只记录不判失败：当前 develop 上就有一条 dsh 插件槽位重复声明的报错，不影响主路。
const uniqErrors = [...new Set(errors)];
if (uniqErrors.length) console.log(`注意 页面未捕获异常 ${uniqErrors.length} 种：${uniqErrors.slice(0, 3).join(' | ')}`);

const pass = checks.every((c) => c.ok);
writeFileSync(join(OUT, 'result.json'), JSON.stringify({ pass, checks, pageErrors: [...new Set(errors)], messages: messages.map(({ id, author, name, text }) => ({ id, author, name, text })) }, null, 2));
process.exit(pass ? 0 : 1);
