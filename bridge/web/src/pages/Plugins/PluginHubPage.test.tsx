import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PluginHubPage from './PluginHubPage';
import { PET_ASSETS, AVAILABLE_PET_PACKS } from './plugins/dshPetPlugin';
import { listRoles } from '@/api/roles';

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
    sessions_count: 2,
    source: 'bridge',
    active_sessions: [
      { sessionId: 'sess-ws1', type: 'working', task: '工作区1：协助审核代码', timestamp: '2026-11-08T23:00:00Z' },
      { sessionId: 'sess-ws2', type: 'thinking', task: '工作区2：跑定向单元测试', timestamp: '2026-11-08T23:01:00Z' },
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
    sessions_count: 0,
    source: 'bridge',
    active_sessions: [],
  },
  {
    name: 'cjiang',
    display_name: 'C酱',
    agent_type: 'reviewer',
    model: 'claude-opus-5-5',
    online: true,
    busy: false,
    current_task: '',
    paused: false,
    platforms: [{ name: 'discord', ready: true }],
    sessions_count: 0,
    source: 'bridge',
    active_sessions: [],
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
    active_sessions: [],
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
    expect(container?.textContent).toContain('桌宠角色与形象包适配');
    expect(container?.textContent).toContain('人格养成 (待接入)');

    // Author and upstream terms are displayed
    expect(container?.textContent).toContain('PC2005-cloud & hunmer');
    expect(container?.textContent).toContain('遵循各形象包自带说明');
    expect(container?.textContent).toContain('MIT');
  });

  it('defaults to single pet display for 肥鱼 (bridge:deep) with dsh1 local installed pack', async () => {
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <PluginHubPage />
        </MemoryRouter>
      );
    });

    // Header explains single pet policy and mapping
    expect(container?.textContent).toContain('只显示一只 (默认)');

    // Default displayed role is 肥鱼 (bridge:deep)
    expect(container?.textContent).toContain('肥鱼');
    expect(container?.textContent).toContain('(bridge:deep)');
    expect(container?.textContent).toContain('肥鱼 (dsh1 新动作包)');
    expect(container?.textContent).toContain('[本地已装]');

    // Multi-session busy badge shows 2 处在忙 (from sess-ws1 working + sess-ws2 thinking)
    const busyBadge = container?.querySelector('[data-testid="busy-badge-bridge:deep"]');
    expect(busyBadge).not.toBeNull();
    expect(busyBadge?.textContent).toContain('2 处在忙');

    // Pet image exists for bridge:deep
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
  });

  it('simulator emits event ONLY to targeted role and does NOT bleed to other roles', async () => {
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <PluginHubPage />
        </MemoryRouter>
      );
    });

    // Target select defaults to bridge:deep
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

  it('switching role in single mode to gjiang displays 形象待接入 without pet image', async () => {
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

    // No pet image should be displayed for unbound gjiang
    expect(container?.querySelector('[data-testid="pet-img-bridge:gjiang"]')).toBeNull();
  });

  it('switching to all roles mode displays grid with deep and cjiang having local installed images', async () => {
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

    // In all roles mode: deep (dsh1) and cjiang (claude) have images, gjiang and gge have empty slot placeholders
    expect(container?.querySelector('[data-testid="pet-img-bridge:deep"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid="pet-img-bridge:cjiang"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid="pet-slot-pending-bridge:gjiang"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid="pet-slot-pending-bridge:gge"]')).not.toBeNull();

    // Exactly 2 images are in the pet grid (deep dsh1 and cjiang claude)
    const images = container?.querySelectorAll('[data-testid^="pet-img-"]');
    expect(images?.length).toBe(2);
  });

  it('displays local installed packs and remote repository packs with distinct badges and links', async () => {
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <PluginHubPage />
        </MemoryRouter>
      );
    });

    // Local installed section has dsh1 and claude (cards do NOT display author or license per user request)
    const dsh1Card = container?.querySelector('[data-testid="installed-pack-dsh1"]');
    expect(dsh1Card).not.toBeNull();
    expect(dsh1Card?.textContent).toContain('本地已装');
    expect(dsh1Card?.textContent).toContain('~/.bothouse/pets/dsh1');
    expect(dsh1Card?.textContent).not.toContain('作者：');
    expect(dsh1Card?.textContent).not.toContain('许可协议：');

    const claudeCard = container?.querySelector('[data-testid="installed-pack-claude"]');
    expect(claudeCard).not.toBeNull();
    expect(claudeCard?.textContent).toContain('本地已装');
    expect(claudeCard?.textContent).toContain('~/.bothouse/pets/claude');
    expect(claudeCard?.textContent).not.toContain('作者：');
    expect(claudeCard?.textContent).not.toContain('许可协议：');

    // Remote packs have uninstalled badges and download buttons (no author or license on card)
    const gpt1Card = container?.querySelector('[data-testid="remote-pack-gpt1"]');
    expect(gpt1Card).not.toBeNull();
    expect(gpt1Card?.textContent).toContain('未安装 (仅来源仓库)');
    expect(gpt1Card?.textContent).not.toContain('作者：');
    expect(gpt1Card?.textContent).not.toContain('许可协议：');
    expect(container?.querySelector('[data-testid="download-link-gpt1"]')).not.toBeNull();

    const geminiCard = container?.querySelector('[data-testid="remote-pack-gemini"]');
    expect(geminiCard).not.toBeNull();
    expect(geminiCard?.textContent).toContain('未安装 (仅来源仓库)');
    expect(container?.querySelector('[data-testid="download-link-gemini"]')).not.toBeNull();

    const dshOfficialCard = container?.querySelector('[data-testid="remote-pack-dsh-official"]');
    expect(dshOfficialCard).not.toBeNull();
    expect(dshOfficialCard?.textContent).toContain('未安装 (仅来源仓库)');
    expect(dshOfficialCard?.textContent).not.toContain('代码 MIT');
    expect(container?.querySelector('[data-testid="download-link-dsh-official"]')).not.toBeNull();
  });

  // Targeted regression test 1 (G哥 feedback): preserves real API source and avoids converting to bridge
  it('preserves real API source from listRoles and does not override to bridge', async () => {
    const customRoles = [
      {
        name: 'deep',
        display_name: '肥鱼DSH',
        agent_type: 'deepseek',
        model: 'deepseek-v4.1-flash',
        online: true,
        busy: false,
        current_task: '',
        paused: false,
        platforms: [{ name: 'discord', ready: true }],
        sessions_count: 0,
        source: 'dsh',
        active_sessions: [],
      },
    ];

    vi.mocked(listRoles).mockResolvedValueOnce({ roles: customRoles as any });

    await act(async () => {
      root?.render(
        <MemoryRouter>
          <PluginHubPage />
        </MemoryRouter>
      );
    });

    // The rendered roleKey should preserve source 'dsh', yielding dsh:deep
    const roleKeyTag = container?.querySelector('[data-testid="role-key-tag-dsh:deep"]');
    expect(roleKeyTag).not.toBeNull();
    expect(roleKeyTag?.textContent).toContain('(dsh:deep)');
  });

  // Targeted regression test 2 (G哥 feedback): API busy=false role stays idle and does not get injected with demo sessions
  it('keeps role completely idle when API returns busy=false and does not inject fake active sessions', async () => {
    const idleDeep = [
      {
        name: 'deep',
        display_name: '肥鱼',
        agent_type: 'deepseek',
        model: 'deepseek-v4.1-flash',
        online: true,
        busy: false,
        current_task: '',
        paused: false,
        platforms: [{ name: 'discord', ready: true }],
        sessions_count: 0,
        source: 'bridge',
        active_sessions: [],
      },
    ];

    vi.mocked(listRoles).mockResolvedValueOnce({ roles: idleDeep as any });

    await act(async () => {
      root?.render(
        <MemoryRouter>
          <PluginHubPage />
        </MemoryRouter>
      );
    });

    // Role badge should be 待机中
    const card = container?.querySelector('[data-testid="pet-card-bridge:deep"]');
    expect(card?.textContent).toContain('待机中');
    expect(card?.textContent).not.toContain('干活中');

    // No busy sessions badge
    expect(container?.querySelector('[data-testid="busy-badge-bridge:deep"]')).toBeNull();
  });
});
