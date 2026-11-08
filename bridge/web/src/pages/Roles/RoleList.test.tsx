import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RoleList from './RoleList';
import { listRoles, type RoleInfo } from '@/api/roles';

vi.mock('@/api/roles', () => ({
  listRoles: vi.fn(),
  restartRole: vi.fn(),
  setRolePaused: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, def?: string) => def || _key, i18n: { language: 'zh' } }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const containers: HTMLDivElement[] = [];
const roots: ReturnType<typeof createRoot>[] = [];

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  containers.splice(0).forEach((container) => container.remove());
  vi.resetAllMocks();
});

async function renderRoleList() {
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <RoleList />
      </MemoryRouter>
    );
  });
  return container;
}

describe('RoleList quota display', () => {
  it('displays both 5h and week quota when present', async () => {
    const roles: RoleInfo[] = [
      {
        name: 'gjiang',
        display_name: '大豆包',
        agent_type: 'gemini',
        model: 'gemini-2.5-pro',
        online: true,
        busy: false,
        current_task: '空闲',
        paused: false,
        platforms: [{ name: 'web', ready: true }],
        sessions_count: 1,
        quota: {
          windows: [
            { name: '5小时', label: '5h', used_percent: 5, remaining_percent: 95, window_seconds: 18000 },
            { name: '周额度', label: '周', used_percent: 20, remaining_percent: 80, window_seconds: 604800 },
          ],
        },
      },
    ];
    vi.mocked(listRoles).mockResolvedValue({ roles });

    const container = await renderRoleList();
    const quotaSection = container.querySelector('[data-testid="role-quota-gjiang"]');
    expect(quotaSection).not.toBeNull();
    expect(quotaSection?.textContent).toContain('模型额度：');
    expect(quotaSection?.textContent).toContain('5h');
    expect(quotaSection?.textContent).toContain('剩 95%');
    expect(quotaSection?.textContent).toContain('周');
    expect(quotaSection?.textContent).toContain('剩 80%');
  });

  it('displays single quota window when partially available', async () => {
    const roles: RoleInfo[] = [
      {
        name: 'deep',
        display_name: '肥鱼',
        agent_type: 'deepseek',
        model: 'deepseek-chat',
        online: true,
        busy: false,
        current_task: '空闲',
        paused: false,
        platforms: [{ name: 'qq', ready: true }],
        sessions_count: 1,
        quota: {
          windows: [
            { name: '5小时', label: '5h', used_percent: 10, remaining_percent: 90, window_seconds: 18000 },
          ],
        },
      },
    ];
    vi.mocked(listRoles).mockResolvedValue({ roles });

    const container = await renderRoleList();
    const quotaSection = container.querySelector('[data-testid="role-quota-deep"]');
    expect(quotaSection).not.toBeNull();
    expect(quotaSection?.textContent).toContain('5h');
    expect(quotaSection?.textContent).toContain('剩 90%');
    expect(quotaSection?.textContent).not.toContain('周');
  });

  it('displays 0% remaining correctly without treating 0 as missing', async () => {
    const roles: RoleInfo[] = [
      {
        name: 'claude',
        display_name: 'C酱',
        agent_type: 'claude',
        model: 'claude-3-7-sonnet',
        online: true,
        busy: false,
        current_task: '空闲',
        paused: false,
        platforms: [{ name: 'discord', ready: true }],
        sessions_count: 1,
        quota: {
          windows: [
            { name: '5小时', label: '5h', used_percent: 100, remaining_percent: 0, window_seconds: 18000 },
          ],
        },
      },
    ];
    vi.mocked(listRoles).mockResolvedValue({ roles });

    const container = await renderRoleList();
    const quotaSection = container.querySelector('[data-testid="role-quota-claude"]');
    expect(quotaSection).not.toBeNull();
    expect(quotaSection?.textContent).toContain('5h');
    expect(quotaSection?.textContent).toContain('剩 0%');
  });

  it('hides quota row completely when quota is absent or windows array is empty', async () => {
    const roles: RoleInfo[] = [
      {
        name: 'role-no-quota',
        agent_type: 'custom',
        model: 'custom-model',
        online: true,
        busy: false,
        current_task: '空闲',
        paused: false,
        platforms: [],
        sessions_count: 0,
      },
      {
        name: 'role-empty-quota',
        agent_type: 'custom',
        model: 'custom-model',
        online: true,
        busy: false,
        current_task: '空闲',
        paused: false,
        platforms: [],
        sessions_count: 0,
        quota: { windows: [] },
      },
    ];
    vi.mocked(listRoles).mockResolvedValue({ roles });

    const container = await renderRoleList();
    expect(container.querySelector('[data-testid="role-quota-role-no-quota"]')).toBeNull();
    expect(container.querySelector('[data-testid="role-quota-role-empty-quota"]')).toBeNull();
  });
});
