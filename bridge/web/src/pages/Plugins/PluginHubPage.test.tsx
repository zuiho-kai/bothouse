import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PluginHubPage from './PluginHubPage';
import { PET_ASSETS } from './plugins/dshPetPlugin';
import type { RoleInfo } from '@/api/roles';

const mockRoles: RoleInfo[] = [
  {
    name: 'deep',
    display_name: '肥鱼',
    agent_type: 'deepseek',
    model: 'deepseek-v4.1-flash',
    online: true,
    busy: false,
    current_task: '',
    paused: false,
    platforms: [{ name: 'qq', ready: true }, { name: 'discord', ready: true }],
    sessions_count: 12,
  },
  {
    name: 'gjiang',
    display_name: '大豆包',
    agent_type: 'frontend',
    model: 'gemini-3.8-flash',
    online: true,
    busy: true,
    current_task: '开发插件接口界面',
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

describe('PluginHubPage - 插件总页与生态接口界面', () => {
  it('renders plugin interface header and registry cards', async () => {
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <PluginHubPage />
        </MemoryRouter>
      );
    });

    expect(container?.textContent).toContain('插件总页与生态接口');
    expect(container?.textContent).toContain('统一插件接口规范');
    expect(container?.textContent).toContain('已接入插件列表');
    expect(container?.textContent).toContain('DSH 原生配置管理');

    // Both plugins are listed
    expect(container?.textContent).toContain('桌宠大肥鱼 (dsh-pet)');
    expect(container?.textContent).toContain('人格养成 (待接入)');

    // Author and repo are displayed
    expect(container?.textContent).toContain('PC2005-cloud');
    expect(container?.textContent).toContain('CC BY-NC-SA 4.0');
    expect(container?.textContent).toContain('MIT');
  });

  it('renders unified role event simulator on the interface page', async () => {
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <PluginHubPage />
        </MemoryRouter>
      );
    });

    expect(container?.textContent).toContain('统一角色事件模拟发射器');

    // All unified event buttons are present
    expect(container?.textContent).toContain('待机呼吸');
    expect(container?.textContent).toContain('干活中');
    expect(container?.textContent).toContain('思考中');
    expect(container?.textContent).toContain('交活庆祝');
    expect(container?.textContent).toContain('出错/疲惫');
    expect(container?.textContent).toContain('说了一句');
  });

  it('defaults to single pet display for 肥鱼 (deep) with fat fish asset pack', async () => {
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <PluginHubPage />
        </MemoryRouter>
      );
    });

    // Header explains single pet policy and mapping
    expect(container?.textContent).toContain('一个角色一只桌宠');
    expect(container?.textContent).toContain('只显示一只 (默认)');

    // Default displayed role is 肥鱼
    expect(container?.textContent).toContain('肥鱼');
    expect(container?.textContent).toContain('大肥鱼形象包');

    // Fat fish image exists for deep
    const deepImg = container?.querySelector('[data-testid="pet-img-deep"]');
    expect(deepImg).not.toBeNull();
    expect(deepImg?.getAttribute('src')).toContain(PET_ASSETS.idle.filename);
  });

  it('switching role in single mode to gjiang displays 形象待接入 without fat fish image', async () => {
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <PluginHubPage />
        </MemoryRouter>
      );
    });

    // Find the select dropdown
    const select = container?.querySelector('[data-testid="pet-role-select"]') as HTMLSelectElement | null;
    expect(select).not.toBeNull();

    await act(async () => {
      if (select) {
        select.value = 'gjiang';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    // In single mode with gjiang selected:
    expect(container?.textContent).toContain('大豆包');
    expect(container?.textContent).toContain('形象待接入');
    expect(container?.querySelector('[data-testid="pet-slot-pending-gjiang"]')).not.toBeNull();

    // Fat fish image should NOT be displayed for gjiang
    expect(container?.querySelector('[data-testid="pet-img-gjiang"]')).toBeNull();
  });

  it('switching to all roles mode displays grid where only deep has fat fish image', async () => {
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <PluginHubPage />
        </MemoryRouter>
      );
    });

    // Click "全部角色" mode button
    const allBtn = container?.querySelector('[data-testid="mode-all-btn"]') as HTMLButtonElement | null;
    expect(allBtn).not.toBeNull();

    await act(async () => {
      allBtn?.click();
    });

    // In all roles mode: deep has image, while gjiang and gge have empty slot placeholders
    expect(container?.querySelector('[data-testid="pet-img-deep"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid="pet-slot-pending-gjiang"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid="pet-slot-pending-gge"]')).not.toBeNull();

    // Only 1 image is in the pet grid (for deep)
    const images = container?.querySelectorAll('img');
    expect(images?.length).toBe(1);
  });

  it('emits unified event and drives pet animation response for 肥鱼', async () => {
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <PluginHubPage />
        </MemoryRouter>
      );
    });

    // Find and click "交活庆祝" simulator button
    const celebBtn = Array.from(container?.querySelectorAll('button') || []).find((b) =>
      b.textContent?.includes('交活庆祝')
    );
    expect(celebBtn).toBeDefined();

    await act(async () => {
      celebBtn?.click();
    });

    // Event broadcaster badge should show "正在广播：celebrate"
    expect(container?.textContent).toContain('正在广播：celebrate');

    // Deep's pet image should switch to celebrate gif
    const deepImg = container?.querySelector('[data-testid="pet-img-deep"]');
    expect(deepImg?.getAttribute('src')).toContain(PET_ASSETS.celebrate.filename);
  });

  it('switches dedicated area to personality nurture placeholder', async () => {
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <PluginHubPage />
        </MemoryRouter>
      );
    });

    // Click on the Personality Nurture card or its button
    const buttons = Array.from(container?.querySelectorAll('button') || []);
    const enterNurtureBtn = buttons.find(
      (b) => b.textContent?.includes('进入专区') || b.textContent?.includes('人格养成')
    );

    await act(async () => {
      enterNurtureBtn?.click();
    });

    // Dedicated area should show personality content
    expect(container?.textContent).toContain('人格养成与好感度系统');
    expect(container?.textContent).toContain('第三方插件如何与 bothouse 角色事件协同');
  });
});
