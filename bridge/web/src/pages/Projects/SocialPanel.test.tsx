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

const moment = {
  id: 'tid-1',
  text: '原来的说法',
  time: '2026-11-08T00:00:00Z',
  images: [] as string[],
  private: false,
  private_known: true,
};

async function renderPanel(caps: Record<string, boolean>, moments = [moment]) {
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
    moments,
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

  it('tells the person there are two posts when only the delete failed, and reloads the list', async () => {
    // 后端部分成功：ok:false 且带 moment（新的已发出、旧的没删）。面板要关掉编辑器、
    // 重新拉一次列表，让人亲眼看到两条，而不是停在编辑器里等人再点一次。
    const err = Object.assign(new Error('新的已经发出（tid=tid-2），但旧的 tid-1 没删掉，现在空间里有两条'), {
      body: { ok: false, error: '两条', moment: { ...moment, id: 'tid-2', text: '换个说法' } },
    });
    vi.mocked(replaceMoment).mockRejectedValue(err);
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

    expect(byTestId(container, 'social-failed')?.textContent).toContain('两条');
    expect(byTestId(container, 'social-editor-tid-1')).toBeNull();
    // 失败后重新读列表：第一次渲染一次，这次再一次。
    expect(vi.mocked(getSocial)).toHaveBeenCalledTimes(2);
    // 面板不替人重试：仍然只有那一次 replace。
    expect(replaceMoment).toHaveBeenCalledTimes(1);
  });

  it('says the pictures move over when the post has images', async () => {
    const withImage = { ...moment, images: ['https://example.invalid/a.png'] };
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const container = await renderPanel({ replace_moment: true }, [withImage]);

    await act(async () => {
      byTestId(container, 'social-replace-tid-1')!.click();
    });
    expect(byTestId(container, 'social-edit-keeps-images-tid-1')?.textContent).toContain('1');
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

  it('does not offer to replace a post that only some people can see', async () => {
    const limited = { ...moment, private: true };
    const container = await renderPanel({ replace_moment: true }, [limited]);

    // 不给按钮：上游说不出是好友可见、部分好友还是仅自己，换一条就会变成所有人可见。
    expect(byTestId(container, 'social-replace-tid-1')).toBeNull();
    const note = byTestId(container, 'social-replace-private-tid-1');
    expect(note).not.toBeNull();
    expect(note!.textContent).toContain('QQ');
    expect(note!.getAttribute('role')).toBe('status');
    // 删还是可以删的，这里不改删除的能力。
    expect(byTestId(container, 'social-delete-tid-1')).not.toBeNull();
  });

  it('does not offer to replace a post whose audience the backend could not read', async () => {
    // 后端说 private_known=false：上游没给可见范围。这不是「公开」，可能本来是
    // 仅部分人可见；换一条会发新的删旧的，赌错就把范围改宽，所以按钮也不给。
    const unknown = { ...moment, private_known: false };
    const container = await renderPanel({ replace_moment: true }, [unknown]);

    expect(byTestId(container, 'social-replace-tid-1')).toBeNull();
    const note = byTestId(container, 'social-replace-unknown-tid-1');
    expect(note).not.toBeNull();
    expect(note!.getAttribute('role')).toBe('status');
    expect(byTestId(container, 'social-replace-private-tid-1')).toBeNull();
    expect(byTestId(container, 'social-delete-tid-1')).not.toBeNull();
  });
});
