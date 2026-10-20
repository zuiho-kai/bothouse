// 无头 Chromium 打开隔离 cc-connect 的管理页并截图（视口用 Playwright 默认值）。
// 输入（环境变量）：BASE_URL、TOKEN、PROJECT、OUT。输出：OUT/*.png 与 OUT/pages.json。
// 任一页加载失败、有未捕获的前端异常、或需登录的页被打回登录页，退出码非零。
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const { BASE_URL, TOKEN, PROJECT, OUT } = process.env;
for (const [k, v] of Object.entries({ BASE_URL, TOKEN, PROJECT, OUT })) {
  if (!v) throw new Error(`缺环境变量 ${k}`);
}

// 安装向导（PR #149）合并后在这里追加向导页。
const pages = [
  { name: 'login', path: '/login', auth: false },
  { name: 'projects', path: '/projects', auth: true },
  { name: 'project-detail', path: `/projects/${encodeURIComponent(PROJECT)}`, auth: true },
];

const browser = await chromium.launch();
const results = [];
let failed = false;
// 主题取值来自 web/src/store 里 cc_theme 的两种值。
for (const theme of ['dark', 'light']) {
  const context = await browser.newContext({ locale: 'zh-CN' });
  await context.addInitScript((t) => localStorage.setItem('cc_theme', t), theme);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  for (const p of pages) {
    errors.length = 0;
    if (p.auth) {
      await page.goto(`${BASE_URL}/login?token=${encodeURIComponent(TOKEN)}`, { waitUntil: 'networkidle' });
    }
    const resp = await page.goto(`${BASE_URL}${p.path}`, { waitUntil: 'networkidle' });
    const file = `${p.name}-${theme}.png`;
    await page.screenshot({ path: join(OUT, file), fullPage: true });
    const finalPath = new URL(page.url()).pathname;
    const ok = (resp?.ok() ?? false) && errors.length === 0 && (!p.auth || finalPath !== '/login');
    if (!ok) failed = true;
    results.push({ page: p.name, theme, file, status: resp?.status() ?? null, finalPath, errors: [...errors], ok });
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${file} status=${resp?.status()} path=${finalPath} errors=${errors.length}`);
  }
  await context.close();
}
await browser.close();
writeFileSync(join(OUT, 'pages.json'), JSON.stringify(results, null, 2));
if (failed) process.exitCode = 1;
