import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SocialPanel from './SocialPanel';
import { getSocial, replaceMoment } from '@/api/social';

vi.mock('@/api/social', () => ({
  getSocial: vi.fn(),
  postMoment: vi.fn(),
  replaceMoment: vi.fn(),
  deleteMoment: vi.fn(),
  setAvatar: vi.fn(),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', changeLanguage: vi.fn() } }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const containers: HTMLDivElement[] = [];
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  containers.splice(0).forEach((container) => container.remove());
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

const moment = { id: 'tid-1', text: '原来的说法', time: '2026-11-08T00:00:00Z', images: [], private: false };

async function renderPanel(caps: Record<string, boolean>) {
  vi.mocked(getSocial).mockResolvedValue({
    status: 'ready',
    platform: 'qq',
    capabilities: {
      list_moments: true,
      post_moment: true,
      remove_moment: true,
      replace_moment: caps.replace_moment,
      set_avatar: false,
    },
    moments: [moment],
  } as any);
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(<MemoryRouter><SocialPanel project="test-project" /></MemoryRouter>);
  });
  return container;
}

const byTestId = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-testid="${id}"]`);

describe('social replace', () => {
  it('replaces in one call instead of posting then deleting', async () => {
    vi.mocked(replaceMoment).mockResolvedValue({ moment: { ...moment, id: 'tid-2', text: '换个说法' } } as any);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const container = await renderPanel({ replace_moment: true });

    await act(async () => {
      byTestId(container, 'social-replace-tid-1')!.click();
    });
    const box = byTestId(container, 'social-edit-text-tid-1') as HTMLTextAreaElement;
    expect(box).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(box, '换个说法');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      byTestId(container, 'social-replace-save-tid-1')!.click();
    });

    expect(replaceMoment).toHaveBeenCalledTimes(1);
    expect(replaceMoment).toHaveBeenCalledWith('test-project', 'tid-1', '换个说法');
    expect(byTestId(container, 'social-editor-tid-1')).toBeNull();
  });

  it('hides the button when the backend does not report replace', async () => {
    const container = await renderPanel({ replace_moment: false });
    expect(byTestId(container, 'social-replace-tid-1')).toBeNull();
    // 删还是照旧有，不受影响。
    expect(byTestId(container, 'social-delete-tid-1')).not.toBeNull();
  });

  it('keeps the editor open and shows the reason when the replace fails', async () => {
    vi.mocked(replaceMoment).mockRejectedValue(new Error('新的已经发出，但旧的没删掉，现在空间里有两条'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const container = await renderPanel({ replace_moment: true });

    await act(async () => {
      byTestId(container, 'social-replace-tid-1')!.click();
    });
    const box = byTestId(container, 'social-edit-text-tid-1') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(box, '换个说法');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      byTestId(container, 'social-replace-save-tid-1')!.click();
    });

    expect(byTestId(container, 'social-editor-tid-1')).not.toBeNull();
    expect(byTestId(container, 'social-failed')?.textContent).toContain('两条');
  });
});
