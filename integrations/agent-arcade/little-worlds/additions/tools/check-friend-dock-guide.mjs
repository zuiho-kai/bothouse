// Use a built game checkout and fresh visitors. Only the destination owner is seeded.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { chromium, expect } from '@playwright/test';
import { openStore } from '../src/server/store.ts';
import { HUB_DOCK } from '../src/shared/ports.ts';

const [gameRoot, output] = process.argv.slice(2);
if (!gameRoot || !output) throw Error('Pass the checkout containing dist and an evidence directory.');
await mkdir(output, { recursive: true });
const db = join(await mkdtemp(join(tmpdir(), 'dock-guide-')), 'world.sqlite');
const store = openStore(db, { integratedWorld: true });
const target = store.create(randomBytes(32).toString('hex')).planetId;
store.close();
const probe = createServer().listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise(done => probe.close(done));
const origin = 'http://127.0.0.1:' + port;
const server = spawn(process.execPath, ['src/server/index.ts'], {
  cwd: resolve(gameRoot), windowsHide: true, stdio:'ignore',
  env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOST: '127.0.0.1', PORT: String(port), DATABASE_PATH: db },
});
let browser;
const results = [];
try {
  await expect.poll(() => fetch(origin + '/healthz').then(r => r.ok).catch(() => false)).toBe(true);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage();
    const record = { width, height, target, passed: false };
    results.push(record);
    try {
      await page.goto(origin + '/?visit=' + target);
      const canvas = page.locator('#world canvas').first();

      await expect.poll(async () => {
        for (const id of ['#appearance-save', '.tutorial-skip', '#welcome-start']) {
          const action = page.locator(id).first();
          if (await action.isVisible() && await action.isEnabled()) {
            try { await action.click({timeout: 1000}); }
            catch (error) { if (await action.isVisible()) throw error; }
            return null;
          }
        }
        if (await page.locator('dialog[open]').count()) return null;
        return canvas.getAttribute('data-grounded');
      }, { timeout: 60000 }).toBe('true');
      const visit = page.locator('#friend-visit-route');
      const board = page.locator('#board-ship');
      const guide = page.locator('#world-guide-hud');
      await visit.click();
      // Start following the route using the guide's own walking control.
      await page.locator('#world-guide-walk').click();
      await expect(guide).toBeVisible();
      for (let i = 0; i < 90 && !(await board.isVisible()); i++) {
        const { up, forward } = await canvas.evaluate(c => ({
          up: JSON.parse(c.dataset.groundPosition), forward: JSON.parse(c.dataset.cameraHeading),
        }));
        const [x,y,z] = forward, [a,b,c] = up;
        const right = [y*c-z*b, z*a-x*c, x*b-y*a];
        const towards = axis => axis.reduce((sum, v, k) => sum + v*HUB_DOCK[k], 0);
        const dx = towards(right), dy = towards(forward), keys = [];
        if (Math.abs(dx) > Math.abs(dy)*.45) keys.push(dx > 0 ? 'd' : 'a');
        if (Math.abs(dy) > Math.abs(dx)*.45) keys.push(dy > 0 ? 'w' : 's');
        for (const key of keys) await page.keyboard.down(key);
        await page.waitForTimeout(450);
        for (const key of keys) await page.keyboard.up(key);
      }
      await expect(board).toBeVisible();
      await expect(guide).toBeVisible();
      record.dockDistance = Number(await canvas.getAttribute('data-port-distance'));
      record.pointerTargets = await visit.evaluate(b => {
        const r=b.getBoundingClientRect();
        return [.2,.5,.8].map(f => document.elementFromPoint(r.x+r.width*f, r.y+r.height/2)?.id);
      });
      await page.screenshot({path: join(output, width+'-at-dock.png')});
      await visit.click({ timeout: 4000 });
      await expect(page.locator('#trip-departure')).toHaveValue(target);
      await page.locator('#cancel-flight').click();
      await expect(guide).toBeVisible();
      await board.click({timeout:4000});
      await expect(page.locator('#confirm-flight')).toBeVisible();
      await page.locator('#cancel-flight').click();
      await page.locator('#world-guide-details').click({timeout:4000});
      await expect(page.locator('#world-guide-dialog')).toBeVisible();
      assert.deepEqual(record.pointerTargets, Array(3).fill('friend-visit-route'));
      record.passed = true;
    } catch (error) {
      record.error = error.message;
      record.visibleButtons = await page.locator('button:visible').evaluateAll(nodes => nodes.map(b=>b.id||b.textContent.trim()));
      await page.screenshot({path: join(output, width+'-failure.png')}).catch(()=>{});
    } finally {
      await writeFile(join(output, 'receipt.json'), JSON.stringify(results,null,2));
      await ctx.close();
    }
  }
  assert(results.every(r=>r.passed), 'See '+join(output,'receipt.json'));
} finally {
  try { await browser?.close(); } finally { server.kill(); }
}
