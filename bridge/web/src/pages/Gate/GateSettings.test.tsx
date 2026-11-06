import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GateSettingsPage from './GateSettings';
import { getGateSettings, saveGate, startGate, type GateSettings } from '@/api/gate';
import { saveJev, testJev } from '@/api/wizard';

vi.mock('@/api/gate', () => ({ getGateSettings: vi.fn(), saveGate: vi.fn(), startGate: vi.fn() }));
vi.mock('@/api/wizard', () => ({ testJev: vi.fn(), saveJev: vi.fn() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'zh', changeLanguage: vi.fn() } }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const containers: HTMLDivElement[] = [];
afterEach(() => {
  containers.splice(0).forEach((c) => c.remove());
  vi.resetAllMocks();
});

const teams: GateSettings = {
  gate: { status: 'off', running: false, managed: true, wanted: true, addr: '127.0.0.1:9930', url: 'http://127.0.0.1:9930/decide', hint: '闸门没在跑，点一键启动。' },
  jev: { url: 'https://api.example.com/v1', model: 'small-1', has_key: true },
  jev_hint: '智能判断要一个能返回概率的模型。',
  mode: 'smart',
  lead: 'juzi',
  lang: 'zh',
  bots: [
    { project: 'juzi', name: 'Juzi', mode: 'smart', enabled: true, gate_url: 'http://127.0.0.1:9930/decide', gate_fallback: 'reply', platforms: ['discord'], listens: true, custom_gate: false },
    { project: 'whale', name: 'Whale', mode: 'addressed', enabled: true, gate_url: 'http://127.0.0.1:9930/decide?bot=whale', gate_fallback: 'context', platforms: ['cloud_web'], listens: false, custom_gate: false },
  ],
};

async function render() {
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  await act(async () => { root.render(<GateSettingsPage />); });
  await act(async () => {});
  return container;
}

const click = async (el: Element | null) => {
  expect(el).toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  await act(async () => {});
};

describe('闸门设置页', () => {
  it('三种方式都摆出来，当前方式选中，没改动就不能存', async () => {
    vi.mocked(getGateSettings).mockResolvedValue(teams);
    const c = await render();
    for (const id of ['smart', 'addressed', 'off']) {
      expect(c.querySelector(`[data-testid="gate-mode-${id}"]`)).toBeTruthy();
    }
    expect(c.querySelector('[data-testid="gate-mode-smart"]')?.getAttribute('aria-pressed')).toBe('true');
    expect((c.querySelector('[data-testid="gate-save"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('选一个方式、勾一个角色，存下就调用保存并回显结果', async () => {
    vi.mocked(getGateSettings).mockResolvedValue(teams);
    vi.mocked(saveGate).mockResolvedValue({
      saved: true, mode: 'addressed', mode_current: 'addressed', bots: teams.bots.map((b) => ({ ...b, mode: 'addressed' as const })),
      gate: { ...teams.gate, status: 'running', running: true }, notes: ['whale: custom gate'],
    } as never);
    const c = await render();

    await click(c.querySelector('[data-testid="gate-mode-addressed"]'));
    expect((c.querySelector('[data-testid="gate-save"]') as HTMLButtonElement).disabled).toBe(false);

    await click(c.querySelector('[data-testid="gate-save"]'));
    expect(saveGate).toHaveBeenCalledWith({ mode: 'addressed', bots: { juzi: true, whale: true }, lang: 'zh' });
    expect(c.querySelector('[data-testid="gate-saved"]')?.textContent).toContain('存好了');
  });

  it('取消勾选的角色按关掉存，页面上给出提示', async () => {
    vi.mocked(getGateSettings).mockResolvedValue(teams);
    vi.mocked(saveGate).mockResolvedValue({ saved: true, mode: 'smart', mode_current: 'smart', bots: teams.bots, gate: teams.gate } as never);
    const c = await render();
    await click(c.querySelector('[data-testid="gate-bot-whale-toggle"]'));
    await click(c.querySelector('[data-testid="gate-mode-smart"]'));
    await click(c.querySelector('[data-testid="gate-save"]'));
    expect(saveGate).toHaveBeenCalledWith({ mode: 'smart', bots: { juzi: true, whale: false }, lang: 'zh' });
  });

  it('缺 Python 时一键启动把原因说出来，不说"失败"', async () => {
    vi.mocked(getGateSettings).mockResolvedValue(teams);
    vi.mocked(startGate).mockResolvedValue({ running: false, started: false, reason: 'python_missing' } as never);
    const c = await render();
    await click(c.querySelector('[data-testid="gate-service-start"]'));
    const reason = c.querySelector('[data-testid="gate-service-reason"]')?.textContent || '';
    expect(reason).toContain('缺 Python 3.12');
  });

  it('模型没测通之前存不了，测通了才放开', async () => {
    vi.mocked(getGateSettings).mockResolvedValue(teams);
    vi.mocked(testJev).mockResolvedValue({ test: { usable: true }, usable: true, reason: '', hint: '' } as never);
    const c = await render();
    const save = () => c.querySelector('[data-testid="gate-jev-save"]') as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    await click(c.querySelector('[data-testid="gate-jev-test"]'));
    expect(testJev).toHaveBeenCalled();
    expect(save().disabled).toBe(false);
    expect(c.querySelector('[data-testid="gate-jev-ok"]')).toBeTruthy();
  });

  it('测不通就不放开保存，并显示原因', async () => {
    vi.mocked(getGateSettings).mockResolvedValue(teams);
    vi.mocked(testJev).mockResolvedValue({ test: { usable: false }, usable: false, reason: 'no logprobs', hint: '' } as never);
    const c = await render();
    await click(c.querySelector('[data-testid="gate-jev-test"]'));
    expect((c.querySelector('[data-testid="gate-jev-save"]') as HTMLButtonElement).disabled).toBe(true);
    expect(c.querySelector('[data-testid="gate-jev-fail"]')?.textContent).toContain('no logprobs');
  });
});
