import { useEffect, useRef, useState } from 'react';
import { Button, Card, Input, Textarea } from '@/components/ui';
import {
  configureDSH, getCLIs, getDSHStatus, installDSHPlugin, openDSHWeb,
  type DSHMember, type DSHStatus, type LocalCLI,
} from '@/api/wizard';
import { api } from '@/api/client';
import { PersonaLibrary, useLibrary } from '@/components/library';
import { type LibraryPersona } from '@/api/library';
import { nextRoleName, personaWithName, roleLabel } from '@/lib/roleIdentity';
import { fmt, libraryTexts } from '@/pages/Setup/texts';

/** install.sh `== step:` markers, in order (dsh/install.sh). */
const INSTALL_STEPS = ['download', 'deps', 'plugin'] as const;
/** Wizard CLI agent types → collab member cli (dsh/collab/roster.mjs CLIS). */
const CLI_OF: Record<string, DSHMember['cli']> = { claudecode: 'claude', codex: 'codex', gemini: 'gemini' };
const DEEPSEEK = 'deepseek';

/**
 * The panel serves the channels page under /dsh/ (bridge/core/management_dsh_proxy.go), so it opens from
 * wherever the panel itself was opened (another device over Tailscale included). `?token=` trades the panel
 * token for a /dsh/-only cookie and is dropped from the address bar by a redirect.
 */
function channelsURL(): string {
  const token = api.getToken();
  return `/dsh/${token ? `?token=${encodeURIComponent(token)}` : ''}#channels`;
}

type Role = { key: number; name: string; nameCustomized: boolean; keepName: boolean; runner: string; persona: string; personaSlug?: string; avatar?: string };

const TEXT = {
  zh: {
    title: 'DSH 安装', steps: ['检测 DSH', '安装插件', '角色和模型', '打开 DSH'],
    note: '装好以后，角色住在 DSH 网页的 #general 频道里，@ 谁谁回。',
    detect: '重新检测', missing: '没找到 dsh。若已安装 DSH 桌面版，请确认将其 bin 目录加入环境变量 PATH；或在终端运行 npm i -g @deepseek-ai/dsh（国内推荐使用 npmmirror 镜像源），再点「重新检测」。',
    install: '安装插件', reinstall: '重新安装', installed: '插件已经装好了。', next: '下一步',
    stepNames: { download: '准备插件文件', deps: '安装依赖', plugin: '装进 DSH' } as Record<string, string>,
    showLog: '查看安装日志',
    rolesTitle: '谁住进 #general', rolesNote: '每个角色用本机已登录的 CLI 回话，或者用 DeepSeek 模型（要 API Key）。',
    name: '名字（@ 时用）', runner: '用什么回话', deepseek: 'DeepSeek 模型（要 API Key）',
    optional: '可选：自定义名字、性格与说话风格、职责', keepName: '保留我的名字',
    noPersona: '默认不附加角色人设，可以直接开始工作。', noName: '名字不能为空。',
    loggedIn: '已登录', notLoggedIn: '未登录', persona: '人设', addRole: '再加一个角色', remove: '删掉',
    cliLoginHint: '先在终端运行 {cli} 登录一次。',
    key: 'DeepSeek API Key', keyHas: '已经保存过 Key，不换可以留空', keyHelp: '在 platform.deepseek.com 的 API Keys 页创建。',
    save: '保存，下一步', noRole: '至少留一个角色。',
    openTitle: '一切就绪', openNote: '点下面的按钮，DSH 会在新标签页打开 #general，角色已经在成员列表里。第一次打开会有一页预览版说明，点「继续」就好。',
    open: '打开 DSH', opening: '正在启动 DSH…', openAgain: '如果没有自动打开，点这里：', back: '返回选择平台', prev: '上一步',
    working: '处理中…',
  },
  ja: {
    title: 'DSH セットアップ', steps: ['DSH を検出', 'プラグインをインストール', 'キャラとモデル', 'DSH を開く'],
    note: 'インストール後、キャラは DSH ウェブの #general チャンネルにいて、@ した相手が返事します。',
    detect: '再検出', missing: 'dsh が見つかりません。公式デスクトップ版をご利用の場合は bin を PATH に追加するか、npm i -g @deepseek-ai/dsh を実行して「再検出」を押してください。',
    install: 'プラグインをインストール', reinstall: '再インストール', installed: 'プラグインはインストール済みです。', next: '次へ',
    stepNames: { download: 'ファイルを準備', deps: '依存関係をインストール', plugin: 'DSH に組み込む' } as Record<string, string>,
    showLog: 'インストールログを見る',
    rolesTitle: '#general に住むキャラ', rolesNote: 'キャラはログイン済みのローカル CLI か、DeepSeek モデル（API Key が必要）で返事します。',
    name: '名前（@ で使う）', runner: '返事に使うもの', deepseek: 'DeepSeek モデル（API Key が必要）',
    optional: '任意：名前、性格・話し方、役割', keepName: '自分の名前を残す',
    noPersona: 'デフォルトでは人格を付けず、そのまま働けます。', noName: '名前を入力してください。',
    loggedIn: 'ログイン済み', notLoggedIn: '未ログイン', persona: 'ペルソナ', addRole: 'キャラを追加', remove: '削除',
    cliLoginHint: '先にターミナルで {cli} を実行してログインしてください。',
    key: 'DeepSeek API Key', keyHas: 'Key は保存済み。変えないなら空欄で OK', keyHelp: 'platform.deepseek.com の API Keys ページで作成します。',
    save: '保存して次へ', noRole: 'キャラを 1 人以上残してください。',
    openTitle: '準備完了', openNote: 'ボタンを押すと DSH が新しいタブで #general を開きます。初回はプレビュー版の説明が出るので「続行」を押してください。',
    open: 'DSH を開く', opening: 'DSH を起動中…', openAgain: '自動で開かない場合はこちら：', back: 'プラットフォーム選択に戻る', prev: '戻る',
    working: '処理中…',
  },
  en: {
    title: 'DSH setup', steps: ['Detect DSH', 'Install plugins', 'Roles and model', 'Open DSH'],
    note: 'Afterwards your roles live in the #general channel of DSH web; whoever you @ replies.',
    detect: 'Detect again', missing: 'dsh not found. If using the official desktop app, ensure its bin directory is on PATH; or run npm i -g @deepseek-ai/dsh in a terminal, then press "Detect again".',
    install: 'Install plugins', reinstall: 'Reinstall', installed: 'The plugins are already installed.', next: 'Next',
    stepNames: { download: 'Prepare plugin files', deps: 'Install dependencies', plugin: 'Add to DSH' } as Record<string, string>,
    showLog: 'Show install log',
    rolesTitle: 'Who lives in #general', rolesNote: 'Each role replies through a signed-in local CLI, or the DeepSeek model (needs an API key).',
    name: 'Name (used with @)', runner: 'Replies with', deepseek: 'DeepSeek model (needs API key)',
    optional: 'Optional: name, personality, speaking style and responsibilities', keepName: 'Keep my name',
    noPersona: 'Ready to work without a persona.', noName: 'A name is required.',
    loggedIn: 'signed in', notLoggedIn: 'not signed in', persona: 'Persona', addRole: 'Add another role', remove: 'Remove',
    cliLoginHint: 'Run {cli} once in a terminal to sign in.',
    key: 'DeepSeek API key', keyHas: 'A key is already saved; leave empty to keep it', keyHelp: 'Create one on the API Keys page of platform.deepseek.com.',
    save: 'Save and continue', noRole: 'Keep at least one role.',
    openTitle: 'All set', openNote: 'The button opens #general in DSH in a new tab, with your roles in the member list. The first time DSH shows a preview notice; press Continue.',
    open: 'Open DSH', opening: 'Starting DSH…', openAgain: 'If nothing opened, click here:', back: 'Back to platforms', prev: 'Back',
    working: 'Working…',
  },
};

export default function DSHSetup({ lang, onBack }: { lang: string; onBack: () => void }) {
  const l = lang.toLowerCase();
  const t = l.startsWith('zh') ? TEXT.zh : l.startsWith('ja') ? TEXT.ja : TEXT.en;
  const { lib, error: libError, reload: reloadLib } = useLibrary(lang);
  const LT = libraryTexts(lang);
  const [status, setStatus] = useState<DSHStatus | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [installStep, setInstallStep] = useState('');
  const [installDone, setInstallDone] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [clis, setClis] = useState<LocalCLI[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [apiKey, setApiKey] = useState('');
  const [openURL, setOpenURL] = useState('');
  const nextKey = useRef(1);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const detect = () => run(async () => { const s = await getDSHStatus(); setStatus(s); setStep(s.found ? 1 : 0); });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- detect once on mount
  useEffect(() => { void detect(); }, []);
  useEffect(() => { getCLIs().then((r) => setClis(r.clis)).catch(() => setClis([])); }, []);

  const runners = clis.filter((c) => c.supported && CLI_OF[c.agent_type]);
  const defaultRunner = () => (runners.find((c) => c.login === 'logged_in') || runners[0])?.agent_type || DEEPSEEK;
  const backendOf = (runner: string) => (runner === DEEPSEEK ? 'dsh' : runner);
  const usedNames = (rs: Role[], except: number) => rs.filter((r) => r.key !== except).map((r) => r.name).filter(Boolean);
  const newRole = (taken: string[]): Role => {
    const runner = defaultRunner();
    return {
      key: nextKey.current++,
      name: nextRoleName(backendOf(runner), taken),
      nameCustomized: false,
      keepName: true,
      runner,
      persona: '',
      personaSlug: '',
      avatar: '',
    };
  };
  // Enter the roles step with one role: named after its CLI, no persona.
  const goRoles = () => { setRoles((rs) => (rs.length ? rs : [newRole([])])); setStep(2); };
  const patch = (key: number, p: Partial<Role>) => setRoles((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const changeRunner = (key: number, runner: string) => setRoles((rs) => {
    const r = rs.find((x) => x.key === key);
    if (!r) return rs;
    const next = { ...r, runner };
    if (!r.nameCustomized) {
      const name = nextRoleName(backendOf(runner), usedNames(rs, key));
      if (r.name && name !== r.name) next.persona = personaWithName(r.persona, r.name, name);
      next.name = name;
    }
    return rs.map((x) => (x.key === key ? next : x));
  });

  const install = () => run(async () => {
    setLog([]); setInstallDone(false); setInstallStep('download');
    try {
      const s = await installDSHPlugin(lang, (ev) => {
        if (ev.step) setInstallStep(ev.step);
        if (ev.line) setLog((xs) => [...xs, ev.line!]);
      });
      setStatus(s); setInstallDone(true); goRoles();
    } catch (e) {
      const extra = (e as { log?: string }).log;
      if (extra) setLog((xs) => [...xs, extra]);
      throw e;
    }
  });
  const needsKey = roles.some((r) => r.runner === DEEPSEEK);
  const save = () => run(async () => {
    if (roles.length === 0) throw new Error(t.noRole);
    if (roles.some((r) => !r.name.trim())) throw new Error(t.noName);
    const members: DSHMember[] = roles.map((r) => ({
      name: r.name.trim(),
      name_customized: r.nameCustomized,
      persona: r.persona,
      avatar: r.avatar || undefined,
      ...(r.runner === DEEPSEEK ? {} : { cli: CLI_OF[r.runner] }),
    }));
    await configureDSH({ deepseek_api_key: needsKey ? apiKey.trim() : undefined, members });
    setStep(3);
  });
  const open = () => {
    // Open the tab inside the click so the browser does not block it, then point it at DSH once it is up.
    const tab = window.open('about:blank', '_blank');
    void run(async () => {
      try {
        await openDSHWeb(); // starts dsh web when it is not running yet
        const url = channelsURL();
        setOpenURL(url);
        if (tab) tab.location.href = url;
      } catch (e) { tab?.close(); throw e; }
    });
  };

  const stepIndex = (s: string) => INSTALL_STEPS.indexOf(s as typeof INSTALL_STEPS[number]);
  const cliLabel = (c: LocalCLI) => `${c.label} · ${c.login === 'logged_in' ? t.loggedIn : c.login === 'not_logged_in' ? t.notLoggedIn : ''}`.replace(/ · $/, '');

  return <div className="space-y-4 max-w-3xl" data-testid="dsh-setup">
    <h2 className="text-lg font-bold">{t.title}</h2><p className="text-sm text-gray-500">{t.note}</p>
    <div className="flex flex-wrap gap-2">{t.steps.map((label, i) => <span key={label}
      className={`rounded-full px-3 py-1 text-sm ${step === i ? 'bg-accent text-white yellow:text-gray-900' : i < step ? 'bg-accent/10 text-accent' : 'bg-gray-100 dark:bg-gray-800'}`}>{i < step ? '✓' : `${i + 1}.`} {label}</span>)}</div>
    <Card className="space-y-4">
      {error && <p role="alert" className="text-red-500 whitespace-pre-wrap" data-testid="dsh-error">{error}</p>}

      {step === 0 && <>
        <p>{status && !status.found ? t.missing : busy ? t.working : t.steps[0]}</p>
        <Button onClick={detect} disabled={busy}>{t.detect}</Button>
      </>}

      {step === 1 && <>
        <p>DSH {status?.version}{status?.plugin_installed && !busy && !log.length ? ` · ${t.installed}` : ''}</p>
        {(busy || log.length > 0) && <ol className="space-y-1 text-sm" data-testid="dsh-install-progress">
          {INSTALL_STEPS.map((s) => {
            const cur = stepIndex(installStep), me = stepIndex(s);
            const state = installDone || me < cur ? 'done' : me === cur ? (busy ? 'active' : 'failed') : 'todo';
            return <li key={s} data-state={state} className={state === 'todo' ? 'text-gray-400' : state === 'failed' ? 'text-red-500' : ''}>
              {state === 'done' ? '✓' : state === 'active' ? '⏳' : state === 'failed' ? '✗' : '○'} {t.stepNames[s]}
            </li>;
          })}
        </ol>}
        {busy && log.length > 0 && <p className="text-xs font-mono text-gray-500 truncate" data-testid="dsh-install-line">{log[log.length - 1]}</p>}
        {log.length > 0 && <details><summary className="text-sm cursor-pointer">{t.showLog}</summary>
          <pre className="text-xs max-h-64 overflow-auto p-2 rounded bg-gray-50 dark:bg-black/40">{log.slice(-200).join('\n')}</pre></details>}
        <div className="flex gap-2">
          <Button onClick={install} disabled={busy} variant={status?.plugin_installed ? 'secondary' : undefined} data-testid="dsh-install-plugin">
            {status?.plugin_installed ? t.reinstall : t.install}</Button>
          {status?.plugin_installed && <Button onClick={goRoles} disabled={busy} data-testid="dsh-skip-install">{t.next}</Button>}
        </div>
      </>}

      {step === 2 && <>
        <div><h3 className="font-semibold">{t.rolesTitle}</h3><p className="text-sm text-gray-500">{t.rolesNote}</p></div>
        {roles.map((r, idx) => {
          const selectedCli = clis.find((c) => c.agent_type === r.runner);
          const notLoggedIn = selectedCli && selectedCli.login === 'not_logged_in';
          return (
            <div key={r.key} className="space-y-3 rounded-lg border border-gray-200 dark:border-gray-700 p-3" data-testid={`dsh-role-${idx}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium" data-testid={`dsh-role-label-${idx}`}>{roleLabel(r.name, backendOf(r.runner))}</p>
                {roles.length > 1 && <Button size="sm" variant="ghost" onClick={() => setRoles((rs) => rs.filter((x) => x.key !== r.key))}>{t.remove}</Button>}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="block mb-1 text-gray-700 dark:text-gray-300">{t.runner}</span>
                  <select className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800"
                    value={r.runner} onChange={(e) => changeRunner(r.key, e.target.value)} data-testid={`dsh-role-runner-${idx}`}>
                    {runners.map((c) => <option key={c.agent_type} value={c.agent_type}>{cliLabel(c)}</option>)}
                    <option value={DEEPSEEK}>{t.deepseek}</option>
                  </select>
                  {notLoggedIn && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-1" data-testid={`dsh-cli-login-hint-${idx}`}>
                      {fmt(t.cliLoginHint, { cli: selectedCli.agent_type })}
                    </p>
                  )}
                </label>
              </div>

              <p className="text-xs text-gray-500">{t.noPersona}</p>
              <details data-testid={`dsh-optional-${idx}`}>
                <summary className="cursor-pointer text-sm">{t.optional}</summary>
                <div className="space-y-2 pt-2">
                  <Input label={t.name} value={r.name} onChange={(e) => patch(r.key, { name: e.target.value, nameCustomized: true })} data-testid={`dsh-role-name-${idx}`} />
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={r.keepName} data-testid={`dsh-keep-name-${idx}`}
                    onChange={(e) => patch(r.key, { keepName: e.target.checked })} />{t.keepName}</label>
                  {lib ? (
                    <PersonaLibrary lib={lib} lang={lang} T={LT} reload={reloadLib} selected={r.personaSlug}
                      onPick={(p: LibraryPersona | null) => patch(r.key, p
                        ? { persona: r.keepName ? personaWithName(p.text, p.name, r.name.trim() || p.name) : p.text,
                            personaSlug: p.slug, avatar: p.avatar || '',
                            ...(r.keepName ? {} : { name: p.name, nameCustomized: true }) }
                        : { persona: '', personaSlug: '', avatar: '' })} />
                  ) : (
                    <p className="text-xs text-gray-500">{libError ? fmt(LT.loadFailed, { error: libError }) : LT.loading}</p>
                  )}
                  <Textarea rows={4} value={r.persona} placeholder={t.persona} onChange={(e) => patch(r.key, { persona: e.target.value })} data-testid={`dsh-role-persona-${idx}`} />
                </div>
              </details>
            </div>
          );
        })}
        <Button variant="secondary" onClick={() => setRoles((rs) => [...rs, newRole(rs.map((x) => x.name))])} data-testid="dsh-add-role">{t.addRole}</Button>
        {needsKey && <div className="space-y-1">
          <Input label={t.key} type="password" autoComplete="off" value={apiKey} placeholder={status?.has_deepseek_key ? t.keyHas : 'sk-…'}
            onChange={(e) => setApiKey(e.target.value)} data-testid="dsh-api-key" />
          <p className="text-xs text-gray-500">{t.keyHelp}</p>
        </div>}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setStep(1)} disabled={busy}>{t.prev}</Button>
          <Button onClick={save} disabled={busy} data-testid="dsh-save-roles">{busy ? t.working : t.save}</Button>
        </div>
      </>}

      {step === 3 && <>
        <div><h3 className="font-semibold">{t.openTitle}</h3><p className="text-sm text-gray-500">{t.openNote}</p></div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setStep(2)} disabled={busy}>{t.prev}</Button>
          <Button onClick={open} disabled={busy} data-testid="dsh-open">{busy ? t.opening : t.open}</Button>
        </div>
        {openURL && <p className="text-sm">{t.openAgain} <a className="text-accent underline break-all" href={openURL} target="_blank" rel="noreferrer" data-testid="dsh-open-link">{openURL}</a></p>}
      </>}

      <Button variant="secondary" onClick={onBack} disabled={busy}>{t.back}</Button>
    </Card>
  </div>;
}
