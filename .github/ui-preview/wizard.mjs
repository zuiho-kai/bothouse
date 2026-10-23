// Real first-run server smoke test; no platforms or models are connected.
// BASE_URL, TOKEN, OUT follow shoot.mjs. Run after starting an isolated bothouse.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const { BASE_URL, TOKEN, OUT } = process.env;
if (!BASE_URL || !TOKEN || !OUT) throw new Error('BASE_URL, TOKEN and OUT required');
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ locale: 'zh-CN', colorScheme: 'dark', viewport: { width: 1440, height: 1000 } });
await context.addInitScript(() => localStorage.setItem('cc_lang', 'zh'));
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const isDark = () => page.evaluate(() => document.documentElement.classList.contains('dark'));
const storedTheme = () => page.evaluate(() => localStorage.getItem('cc_theme'));
const screenshot = async (file) => {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(OUT, file), fullPage: true, animations: 'disabled' });
};
try {
  const response = await page.goto(`${BASE_URL}/login?token=${encodeURIComponent(TOKEN)}&next=/setup`, { waitUntil: 'networkidle' });
  assert.equal(response.status(), 200);
  await page.getByTestId('setup-wizard').waitFor();
  assert.equal(new URL(page.url()).pathname, '/setup');
  assert.equal(await isDark(), false, 'fresh setup is light even on dark OS');
  assert.equal(await page.locator('aside').count(), 0, 'setup has no management sidebar');
  await screenshot('shot-new.png');

  const toggle = page.getByTestId('theme-toggle');
  await toggle.focus();
  await toggle.press('Enter');
  assert.equal(await isDark(), true, 'keyboard style toggle works');
  assert.equal(await storedTheme(), 'dark');
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await isDark(), true, 'dark choice survives reload');
  await screenshot('shot-dark.png');

  for (const style of ['dark', 'light']) {
    if (await isDark() !== (style === 'dark')) await toggle.click();
    for (const platform of ['feishu', 'cloud_web', 'discord']) {
      const card = page.getByTestId(`platform-${platform}`);
      await card.click();
      assert.equal(await card.getAttribute('aria-pressed'), 'true');
    }
    await page.getByTestId('next').click();
    const token = page.getByTestId('token-0');
    await token.fill('ui-preview-placeholder');
    await toggle.click();
    assert.equal(await token.inputValue(), 'ui-preview-placeholder', 'style switch preserves form input');
    await toggle.click();
    assert.equal(await page.getByTestId('next').isDisabled(), true, 'bot validation is still required');
    await page.getByTestId('back').click();
  }
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await isDark(), false, 'light choice survives reload');
  for (const style of ['light', 'dark']) {
    if (await isDark() !== (style === 'dark')) await toggle.click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => {
      const main = document.querySelector('main');
      return main.scrollWidth <= main.clientWidth && document.documentElement.scrollWidth <= innerWidth;
    }), true, 'mobile has no horizontal overflow');
    await screenshot(`shot-mobile-${style}.png`);
  }
  assert.deepEqual(errors, [], 'no uncaught frontend errors');
  writeFileSync(join(OUT, 'wizard-smoke.json'), JSON.stringify({ ok: true, viewport: '1440x1000 / 390x844', styles: ['light', 'dark'], checks: ['fresh light on dark OS', 'keyboard toggle', 'reload persistence', 'platform cards', 'form preservation', 'validation', 'mobile overflow'], errors }, null, 2));
  console.log('Wizard browser smoke passed; desktop/mobile screenshots saved.');
} finally {
  await browser.close();
}
