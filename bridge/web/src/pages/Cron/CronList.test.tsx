import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CronList from './CronList';
import type { CronJob } from '@/api/cron';

const state: { jobs: CronJob[]; created: any[]; updated: any[]; updateError?: string } = { jobs: [], created: [], updated: [] };

const dict: Record<string, string> = {
  'cron.add': '添加任务',
  'cron.sessionKey': '会话键',
  'common.cancel': '取消',
  'cron.projectRequired': '先选项目。',
  'cron.sessionKeyRequired': '先填会话键：任务需要知道发到哪个会话。',
  'cron.scheduleRequired': '先选执行时间。',
  'cron.taskRequired': '请填提示词或命令其中一项。',
  'cron.editJob': '编辑任务',
  'common.save': '保存',
  'cron.prompt': '提示词',
  'cron.exec': '命令',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: any) => dict[key] ?? (typeof fallback === 'string' ? fallback : key),
    i18n: { language: 'zh', changeLanguage: vi.fn() },
  }),
}));

vi.mock('@/api/cron', async () => {
  const actual = await vi.importActual<typeof import('@/api/cron')>('@/api/cron');
  return {
    ...actual,
    listCronJobs: async () => ({ jobs: state.jobs }),
    createCronJob: async (body: any) => {
      state.created.push(body);
      return { ...body, id: 'new1' };
    },
    updateCronJob: async (id: string, patch: any) => {
      state.updated.push({ id, patch });
      if (state.updateError) throw new Error(state.updateError);
      return { id, ...patch };
    },
    deleteCronJob: vi.fn(),
    triggerCronJob: vi.fn(),
  };
});

vi.mock('@/api/projects', async () => {
  const actual = await vi.importActual<typeof import('@/api/projects')>('@/api/projects');
  return {
    ...actual,
    listProjects: async () => ({
      projects: [
        { name: 'deep', display_name: '肥鱼', agent_type: 'claudecode', platforms: ['qq'], sessions_count: 0, heartbeat_enabled: false },
      ],
    }),
  };
});

vi.mock('@/api/sessions', async () => {
  const actual = await vi.importActual<typeof import('@/api/sessions')>('@/api/sessions');
  return { ...actual, listSessions: async () => ({ sessions: [], active_keys: {} }) };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;

beforeEach(() => {
  state.jobs = [];
  state.created = [];
  state.updated = [];
  state.updateError = undefined;
  localStorage.clear();
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

const render = async () => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => { root!.render(<CronList />); });
  await act(async () => {});
};

const buttons = (text: string) =>
  [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === text) as HTMLButtonElement[];
const button = (text: string) => buttons(text)[0];
/** The modal's own submit button; the page header carries the same label for "open the form". */
const submit = (text: string) => buttons(text)[buttons(text).length - 1];

/** Set a controlled input/textarea's value the way a person typing does. */
const type = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const labelOf = (el: Element) => el.closest('div')?.querySelector('label')?.textContent ?? '';

/** A job row opens its edit modal on click (the whole card is the button). */
const openFirstJobCard = () => {
  const card = [...document.querySelectorAll('div')].find(el =>
    el.className.includes('cursor-pointer') && el.textContent?.includes('每日早安')) as HTMLElement | undefined;
  if (!card) throw new Error('job card not found');
  card.click();
};

/** Open the add-task modal, pick the only project and the daily-6:00 preset. */
const openForm = async () => {
  await act(async () => { button('添加任务')!.click(); });
  const selects = [...document.querySelectorAll('select')] as HTMLSelectElement[];
  await act(async () => {
    selects[0].value = 'deep';
    selects[0].dispatchEvent(new Event('change', { bubbles: true }));
  });
  // The schedule picker only offers presets until "custom" is chosen; "* * * * *" is one.
  await act(async () => {
    selects[1].value = '* * * * *';
    selects[1].dispatchEvent(new Event('change', { bubbles: true }));
  });
};

describe('CronList — session key is a field, not a picker of existing chats', () => {
  it('lets a brand-new chat be scheduled by typing its key', async () => {
    await render();
    await openForm();

    const sessionInput = document.querySelector('input[list="cron-session-keys"]') as HTMLInputElement;
    expect(sessionInput).toBeTruthy();
    expect(labelOf(sessionInput)).toContain('会话键');

    await type(sessionInput, 'qq:10001');
    await type(document.querySelector('textarea') as HTMLTextAreaElement, '今天要做什么');
    await act(async () => { submit('添加任务').click(); });
    await act(async () => {});

    expect(state.created).toHaveLength(1);
    expect(state.created[0]).toMatchObject({ project: 'deep', session_key: 'qq:10001', cron_expr: '* * * * *' });
  });

  it('refuses an empty key in the modal and keeps what was typed', async () => {
    await render();
    await openForm();

    await type(document.querySelector('textarea') as HTMLTextAreaElement, '今天要做什么');
    await act(async () => { submit('添加任务').click(); });
    await act(async () => {});

    expect(state.created).toHaveLength(0);
    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe(dict['cron.sessionKeyRequired']);
    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe('今天要做什么');
  });

  it('shows the jobs it fetches', async () => {
    state.jobs = [{
      id: 'j1', project: 'deep', session_key: 'qq:10001', cron_expr: '0 6 * * *',
      prompt: '早安', exec: '', work_dir: '', description: '每日早安', enabled: true,
      silent: false, mute: false, session_mode: '', mode: '', timeout_mins: null,
      created_at: '2026-11-05T00:00:00Z', last_run: '', last_error: '',
    }];
    await render();
    expect(document.body.textContent).toContain('每日早安');
    expect(document.body.textContent).toContain('每天 6:00');
  });
});

describe('CronList — editing keeps the same rules as creating', () => {
  const job = (over: Partial<CronJob> = {}): CronJob => ({
    id: 'j1', project: 'deep', session_key: 'qq:10001', cron_expr: '0 6 * * *',
    prompt: '早安', exec: '', work_dir: '', description: '每日早安', enabled: true,
    silent: false, mute: false, session_mode: '', mode: '', timeout_mins: null,
    created_at: '2026-11-05T00:00:00Z', last_run: '', last_error: '',
    ...over,
  } as CronJob);

  it('trims a pasted key when editing an existing job', async () => {
    state.jobs = [job()];
    await render();
    await act(async () => { openFirstJobCard(); });
    const sessionInput = document.querySelector('input[list="cron-session-keys"]') as HTMLInputElement;
    expect(sessionInput.value).toBe('qq:10001');
    // 粘贴时前后带空格：写进库里的必须是 trim 过的键，否则调度器会去找名叫 " qq" 的平台。
    await type(sessionInput, '  qq:20002  ');
    await act(async () => { submit('保存').click(); });
    await act(async () => {});
    expect(state.updated).toHaveLength(1);
    expect(state.updated[0].patch.session_key).toBe('qq:20002');
  });

  it('shows a server error inside the modal instead of closing it', async () => {
    state.jobs = [job()];
    state.updateError = 'session_key is required';
    await render();
    await act(async () => { openFirstJobCard(); });
    await type(document.querySelector('input[list="cron-session-keys"]') as HTMLInputElement, 'qq:30003');
    await act(async () => { submit('保存').click(); });
    await act(async () => {});
    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('session_key is required');
    // 弹窗还在，输入也还在：不把人填的东西弄丢。
    expect(document.querySelector('input[list="cron-session-keys"]')).toBeTruthy();
  });
});
