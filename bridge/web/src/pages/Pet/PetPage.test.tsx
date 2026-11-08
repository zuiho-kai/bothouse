import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PetPage, { PET_ASSETS } from './PetPage';
import type { RoleInfo } from '@/api/roles';

const mockRoles: RoleInfo[] = [
  {
    name: 'gjiang',
    display_name: '大豆包',
    agent_type: 'frontend',
    model: 'gemini-3.8-flash',
    online: true,
    busy: true,
    current_task: '急速开发桌宠插件演示页',
    paused: false,
    platforms: [{ name: 'discord', ready: true }],
    sessions_count: 5,
  },
  {
    name: 'gge',
    display_name: 'G哥',
    agent_type: 'architect',
    model: 'xiao/gpt-6-astra',
    online: true,
    busy: false,
    current_task: '',
    paused: false,
    platforms: [{ name: 'discord', ready: true }],
    sessions_count: 8,
  },
];

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, f?: string) => f ?? k,
    i18n: { language: 'zh', changeLanguage: vi.fn() },
  }),
}));

vi.mock('@/api/roles', () => ({
  listRoles: vi.fn(async () => ({ roles: mockRoles })),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = undefined;
  root = undefined;
  vi.clearAllMocks();
});

describe('PetPage - 桌宠插件演示页', () => {
  it('renders page header, title, and badge', async () => {
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <PetPage />
        </MemoryRouter>
      );
    });

    expect(container?.textContent).toContain('桌宠插件演示');
    expect(container?.textContent).toContain('dsh-pet 联动原型');
    expect(container?.textContent).toContain('bothouse 面板内置大肥鱼桌宠组件');
  });

  it('renders pet cards with correct assets and role names', async () => {
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <PetPage />
        </MemoryRouter>
      );
    });

    // Contains role display names
    expect(container?.textContent).toContain('大豆包');
    expect(container?.textContent).toContain('G哥');

    // Contains images with preview asset urls
    const images = container?.querySelectorAll('img');
    expect(images && images.length).toBeGreaterThanOrEqual(2);

    // 大豆包 is busy: should default to working asset
    const gjiangImg = Array.from(images || []).find((img) =>
      img.getAttribute('src')?.includes(PET_ASSETS.working.filename)
    );
    expect(gjiangImg).toBeDefined();

    // G哥 is idle: should default to idle asset
    const ggeImg = Array.from(images || []).find((img) =>
      img.getAttribute('src')?.includes(PET_ASSETS.idle.filename)
    );
    expect(ggeImg).toBeDefined();
  });

  it('switches animation when global simulation buttons are clicked', async () => {
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <PetPage />
        </MemoryRouter>
      );
    });

    // Find "交活庆祝" button
    const celebrateBtn = Array.from(container?.querySelectorAll('button') || []).find((btn) =>
      btn.textContent?.includes('交活庆祝')
    );
    expect(celebrateBtn).toBeDefined();

    await act(async () => {
      celebrateBtn?.click();
    });

    // Badge should show 模拟中：雀跃庆祝
    expect(container?.textContent).toContain('模拟中：雀跃庆祝');

    // All images should now show celebrate gif
    const images = container?.querySelectorAll('img');
    const celebrateImgs = Array.from(images || []).filter((img) =>
      img.getAttribute('src')?.includes(PET_ASSETS.celebrate.filename)
    );
    expect(celebrateImgs.length).toBeGreaterThanOrEqual(2);
  });

  it('allows per-role manual simulation toggle', async () => {
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <PetPage />
        </MemoryRouter>
      );
    });

    // Find the first "出错" button in single-role simulation
    const errorBtn = Array.from(container?.querySelectorAll('button') || []).find(
      (btn) => btn.getAttribute('title') === '出错'
    );
    expect(errorBtn).toBeDefined();

    await act(async () => {
      errorBtn?.click();
    });

    // An image should now show error/tired gif
    const images = container?.querySelectorAll('img');
    const errorImg = Array.from(images || []).find((img) =>
      img.getAttribute('src')?.includes(PET_ASSETS.error.filename)
    );
    expect(errorImg).toBeDefined();
  });

  it('renders CC BY-NC-SA 4.0 license and attribution footer', async () => {
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <PetPage />
        </MemoryRouter>
      );
    });

    expect(container?.textContent).toContain('PC2005-cloud/dsh-pet');
    expect(container?.textContent).toContain('CC BY-NC-SA 4.0');
    expect(container?.textContent).toContain('素材通过 jsDelivr CDN 运行时加载，不随 bothouse 仓库打包或分发');
  });
});
