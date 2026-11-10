import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RoleList from './RoleList';

const mocks = vi.hoisted(() => ({
  roles: vi.fn(),
  members: vi.fn(),
  status: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === 'string' ? fallback : key,
  }),
}));

vi.mock('@/api/roles', () => ({
  listRoles: mocks.roles,
  restartRole: vi.fn(),
  setRolePaused: vi.fn(),
}));

vi.mock('@/api/dsh', () => ({
  listDSHMembers: mocks.members,
  getDSHModelRoutes: vi.fn().mockResolvedValue({ routes: [] }),
  getDSHCliOptions: vi.fn().mockResolvedValue({ supported: false }),
  createDSHMember: vi.fn(),
  updateDSHMember: vi.fn(),
  deleteDSHMember: vi.fn(),
}));

vi.mock('@/api/wizard', async (original) => ({
  ...(await original<object>()),
  getDSHStatus: mocks.status,
}));

vi.mock('@/pages/Setup/DSHSetup', () => ({
  default: () => <div>INSTALL WIZARD</div>,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

const flush = async () => {
  await act(async () => {});
};

async function render(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<MemoryRouter>{node}</MemoryRouter>));
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.members.mockResolvedValue({ members: [] });
  mocks.status.mockResolvedValue({ found: true, plugin_installed: true });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

describe('RoleList platform notice badge', () => {
  it('renders a compact badge and tooltip for Server Members Intent notice instead of expanding amber text', async () => {
    const noticeText =
      '没开 SERVER MEMBERS INTENT，收不到进群、退群事件（member.joined / member.left）：到 Discord 开发者后台 → Bot → Privileged Gateway Intents 打开它并保存，再重启 bothouse。https://discord.com/developers/applications/123456/bot';

    mocks.roles.mockResolvedValue({
      roles: [
        {
          name: 'bot-discord',
          display_name: 'Cursor',
          agent_type: 'cursor',
          model: 'claude-3-5-sonnet',
          online: true,
          busy: false,
          current_task: '',
          paused: false,
          sessions_count: 0,
          platforms: [
            {
              name: 'discord',
              ready: true,
              notice: noticeText,
            },
          ],
        },
      ],
      dsh: { status: 'running' },
    });

    await render(<RoleList />);

    // 1. Should not have the expanded amber text
    const amberNotice = container.querySelector('[data-testid="role-platform-notice"]');
    expect(amberNotice).toBeNull();

    // 2. Should render the compact badge inside the platform line next to discord
    const platformDd = container.querySelector('[data-testid="role-platforms"]');
    expect(platformDd).toBeTruthy();
    const badge = platformDd?.querySelector('button');
    expect(badge).toBeTruthy();
    expect(badge?.textContent).toContain('未开成员事件');

    // Should not render an extra notice block for the members-intent case
    expect(container.querySelectorAll('[data-testid="role-platform-notice"]').length).toBe(0);

    // 3. Should have a tooltip with description and developer portal link
    const tooltip = container.querySelector('[role="tooltip"]');
    expect(tooltip).toBeTruthy();
    expect(tooltip?.textContent).toContain(
      '没开 SERVER MEMBERS INTENT，收不到进群、退群事件（member.joined / member.left）'
    );

    const portalLink = tooltip?.querySelector('a');
    expect(portalLink).toBeTruthy();
    expect(portalLink?.getAttribute('href')).toBe(
      'https://discord.com/developers/applications/123456/bot'
    );
    expect(portalLink?.getAttribute('target')).toBe('_blank');
    expect(portalLink?.textContent).toContain('打开 Discord 开发者后台');
  });

  it('keeps blocking or unrelated warnings in prominent amber text', async () => {
    const blockingNotice =
      '机器人「test」没开 Message Content Intent，读不到消息正文，在群里不会回话。';

    mocks.roles.mockResolvedValue({
      roles: [
        {
          name: 'bot-discord',
          display_name: 'BotTest',
          agent_type: 'custom',
          model: 'gpt-4o',
          online: true,
          busy: false,
          current_task: '',
          paused: false,
          sessions_count: 0,
          platforms: [
            {
              name: 'discord',
              ready: false,
              notice: blockingNotice,
            },
          ],
        },
      ],
      dsh: { status: 'running' },
    });

    await render(<RoleList />);

    // 1. Amber notice must be present
    const amberNotice = container.querySelector('[data-testid="role-platform-notice"]');
    expect(amberNotice).toBeTruthy();
    expect(amberNotice?.textContent).toContain('Message Content Intent');

    // 2. The compact members intent badge should not be rendered
    const badge = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('未开成员事件')
    );
    expect(badge).toBeFalsy();
  });

  it('renders nothing extra when platforms have no notice', async () => {
    mocks.roles.mockResolvedValue({
      roles: [
        {
          name: 'bot-normal',
          display_name: 'NormalBot',
          agent_type: 'normal',
          model: 'm1',
          online: true,
          busy: false,
          current_task: '',
          paused: false,
          sessions_count: 0,
          platforms: [
            {
              name: 'discord',
              ready: true,
            },
          ],
        },
      ],
      dsh: { status: 'running' },
    });

    await render(<RoleList />);

    expect(container.querySelector('[data-testid="role-platform-notice"]')).toBeNull();
    expect(container.querySelector('[role="tooltip"]')).toBeNull();
    const badge = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('未开成员事件')
    );
    expect(badge).toBeFalsy();
  });
});
