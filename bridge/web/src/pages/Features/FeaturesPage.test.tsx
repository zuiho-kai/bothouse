import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FeaturesPage from './FeaturesPage';
import { getFeatures, setFeature, type FeatureState } from '@/api/features';

vi.mock('@/api/features', () => ({ getFeatures: vi.fn(), setFeature: vi.fn() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'zh', changeLanguage: vi.fn() } }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const containers: HTMLDivElement[] = [];
afterEach(() => {
  containers.splice(0).forEach((c) => c.remove());
  vi.resetAllMocks();
});

const sw = (over: Partial<FeatureState>): FeatureState => ({
  key: 'stream_preview.enabled', scope: 'global', name: '回复流式预览', name_en: 'Streaming preview',
  desc: '回复边写边显示。', desc_en: 'Show the reply while it is written.', restart: true,
  on: true, default: true, running: true, pending_restart: false, ...over,
});

const list: FeatureState[] = [
  sw({}),
  sw({ key: 'instant_reply.enabled', name: '收到先回一句', restart: false, on: false, default: false, running: false }),
  sw({ key: 'team_board', scope: 'project', project: 'juzi', name: '团队状态板', restart: false }),
  sw({ key: 'team_board', scope: 'project', project: 'whale', name: '团队状态板', restart: false, on: false, running: false }),
];

async function render() {
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  await act(async () => { root.render(<FeaturesPage />); });
  await act(async () => {});
  return container;
}

const click = async (el: Element | null) => {
  expect(el).toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  await act(async () => {});
};

const q = (c: HTMLElement, id: string) => c.querySelector(`[data-testid="${id}"]`);

describe('功能开关页', () => {
  it('lists every global switch with its value, default and restart note, and one column per role', async () => {
    vi.mocked(getFeatures).mockResolvedValue({ features: list, lang: 'zh' });
    const c = await render();
    const stream = q(c, 'feature-stream_preview.enabled')!;
    expect(stream.textContent).toContain('回复流式预览');
    expect(stream.textContent).toContain('默认开');
    expect(stream.textContent).toContain('改后要重启');
    expect(stream.textContent).toContain('stream_preview.enabled');
    expect(stream.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('true');
    const instant = q(c, 'feature-instant_reply.enabled')!;
    expect(instant.textContent).toContain('默认关');
    expect(instant.textContent).not.toContain('改后要重启');
    expect(instant.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('false');
    expect(q(c, 'feature-juzi/team_board')!.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('true');
    expect(q(c, 'feature-whale/team_board')!.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('false');
    expect(q(c, 'features-pending')).toBeNull();
  });

  it('a click writes that switch and says when a restart is needed', async () => {
    vi.mocked(getFeatures).mockResolvedValue({ features: list, lang: 'zh' });
    vi.mocked(setFeature).mockResolvedValue({
      features: [sw({ on: false, pending_restart: true }), ...list.slice(1)], lang: 'zh', restart_required: true,
    });
    const c = await render();
    await click(q(c, 'feature-stream_preview.enabled')!.querySelector('[role="switch"]'));
    expect(setFeature).toHaveBeenCalledWith({ project: undefined, key: 'stream_preview.enabled', on: false });
    expect(q(c, 'feature-stream_preview.enabled')!.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('false');
    expect(q(c, 'features-saved')!.textContent).toContain('重启');
    expect(q(c, 'features-pending')!.textContent).toContain('1 项');
    expect(q(c, 'feature-stream_preview.enabled')!.textContent).toContain('待重启');
  });

  it("a role's switch is written with its role and takes effect at once", async () => {
    vi.mocked(getFeatures).mockResolvedValue({ features: list, lang: 'zh' });
    vi.mocked(setFeature).mockResolvedValue({
      features: [...list.slice(0, 3), { ...list[3], on: true, running: true }], lang: 'zh', restart_required: false,
    });
    const c = await render();
    await click(q(c, 'feature-whale/team_board')!.querySelector('[role="switch"]'));
    expect(setFeature).toHaveBeenCalledWith({ project: 'whale', key: 'team_board', on: true });
    expect(q(c, 'feature-whale/team_board')!.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('true');
    expect(q(c, 'features-saved')!.textContent).toContain('马上生效');
    expect(q(c, 'features-pending')).toBeNull();
  });
});
