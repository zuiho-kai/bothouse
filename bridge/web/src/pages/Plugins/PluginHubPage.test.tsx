import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PluginHubPage from './PluginHubPage';
import { PET_ASSETS } from './plugins/dshPetPlugin';

const mockRoles: any[] = [
  {
    name: 'deep',
    display_name: '肥鱼',
    agent_type: 'deepseek',
    model: 'deepseek-v4.1-flash',
    online: true,
    busy: true,
    current_task: '工作区1：协助审核代码',
    paused: false,
    platforms: [{ name: 'qq', ready: true }, { name: 'discord', ready: true }],
    sessions_count: 3,
    source: 'bridge',
    active_sessions: [
      { sessionId: 'sess-ws1', type: 'working', task: '工作区1：协助审核代码', timestamp: '2026-11-08T23:00:00Z' },
      { sessionId: 'sess-ws2', type: 'thinking', task: '工作区2：跑定向单元测试', timestamp: '2026-11-08T23:01:00Z' },
      { sessionId: 'sess-chat', type: 'idle', task: '聊天频道：待命', timestamp: '2026-11-08T22:50:00Z' },
    ],
  },
  {
    name: 'gjiang',
    display_name: '大豆包',
    agent_type: 'frontend',
    model: 'gemini-3.8-flash',
    online: true,
    busy: false,
    current_task: '',
    paused: false,
    platforms: [{ name: 'discord', ready: true }],
    sessions_count: 1,
    source: 'bridge',
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
    sessions_count: 0,
    source: 'bridge',
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
  it('renders plugin interface header, target role selector and registry cards', async () => {
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

    // Target role selector is present
    expect(container?.querySelector('[data-testid="sim-target-select"]')).not.toBeNull();

    // Both plugins are listed
    expect(container?.textContent).toContain('桌宠大肥鱼 (dsh-pet)');
    expect(container?.textContent).toContain('人格养成 (待接入)');

    // Author and repo are displayed
    expect(container?.textContent).toContain('PC2005-cloud');
    expect(container?.textContent).toContain('CC BY-NC-SA 4.0');
    expect(container?.textContent).toContain('MIT');
  });

  it('defaults to single pet display for 肥鱼 (bridge:deep) with fat fish and multi-session busy count', async () => {
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <PluginHubPage />
        </MemoryRouter>
      );
    });

    // Header explains single pet policy and mapping
    expect(container?.textContent).toContain('独立 roleKey 防串');
    expect(container?.textContent).toContain('只显示一只 (默认)');

    // Default displayed role is 肥鱼 (bridge:deep)
    expect(container?.textContent).toContain('肥鱼');
    expect(container?.textContent).toContain('(bridge:deep)');
    expect(container?.textContent).toContain('大肥鱼形象包');

    // Multi-session busy badge shows 2 处在忙 (from sess-ws1 working + sess-ws2 thinking)
    const busyBadge = container?.querySelector('[data-testid="busy-badge-bridge:deep"]');
    expect(busyBadge).not.toBeNull();
    expect(busyBadge?.textContent).toContain('2 处在忙');

    // Fat fish image exists for bridge:deep
    const deepImg = container?.querySelector('[data-testid="pet-img-bridge:deep"]');
    expect(deepImg).not.toBeNull();
  });

  it('expands active sessions list when busy count badge is clicked', async () => {
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <PluginHubPage />
        </MemoryRouter>
      );
    });

    const busyBadge = container?.querySelector('[data-testid="busy-badge-bridge:deep"]') as HTMLButtonElement | null;
    expect(busyBadge).not.toBeNull();

    // Click to expand
    await act(async () => {
      busyBadge?.click();
    });

    // Expanded panel lists tasks from multi-sessions
    const sessionList = container?.querySelector('[data-testid="sessions-list-bridge:deep"]');
    expect(sessionList).not.toBeNull();
    expect(sessionList?.textContent).toContain('工作区1：协助审核代码');
    expect(sessionList?.textContent).toContain('工作区2：跑定向单元测试');
    expect(sessionList?.textContent).toContain('聊天频道：待命');
  });

  it('simulator emits event ONLY to targeted role and does NOT bleed to other roles', async () => {
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <PluginHubPage />
        </MemoryRouter>
      );
    });

    // Target select is defaults to bridge:deep
    const targetSelect = container?.querySelector('[data-testid="sim-target-select"]') as HTMLSelectElement | null;
    expect(targetSelect?.value).toBe('bridge:deep');

    // Emit celebrate to bridge:deep ONLY
    const celebBtn = container?.querySelector('[data-testid="sim-btn-celebrate"]') as HTMLButtonElement | null;
    expect(celebBtn).not.toBeNull();

    await act(async () => {
      celebBtn?.click();
    });

    // Deep's pet image switches to celebrate
    const deepImg = container?.querySelector('[data-testid="pet-img-bridge:deep"]');
    expect(deepImg?.getAttribute('src')).toContain(PET_ASSETS.celebrate.filename);

    // Switch view to all roles to verify that gjiang and gge were NOT modified to celebrate
    const allBtn = container?.querySelector('[data-testid="mode-all-btn"]') as HTMLButtonElement | null;
    await act(async () => {
      allBtn?.click();
    });

    // gjiang remains idle / pending, not celebrate
    const gjiangCard = container?.querySelector('[data-testid="pet-card-bridge:gjiang"]');
    expect(gjiangCard?.textContent).toContain('待机中');
    expect(gjiangCard?.textContent).not.toContain('交活庆祝');
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
        select.value = 'bridge:gjiang';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    // In single mode with gjiang selected:
    expect(container?.textContent).toContain('大豆包');
    expect(container?.textContent).toContain('(bridge:gjiang)');
    expect(container?.textContent).toContain('形象待接入');
    expect(container?.querySelector('[data-testid="pet-slot-pending-bridge:gjiang"]')).not.toBeNull();

    // Fat fish image should NOT be displayed for gjiang
    expect(container?.querySelector('[data-testid="pet-img-bridge:gjiang"]')).toBeNull();
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
    expect(container?.querySelector('[data-testid="pet-img-bridge:deep"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid="pet-slot-pending-bridge:gjiang"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid="pet-slot-pending-bridge:gge"]')).not.toBeNull();

    // Only 1 image is in the pet grid (for deep)
    const images = container?.querySelectorAll('img');
    expect(images?.length).toBe(1);
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
