import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Laptop, Loader2, Server, XCircle } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { getSSHHosts, testSSHRemote, type SSHTestResult } from '@/api/wizard';
import { isZhLang } from '@/pages/Setup/texts';

/** Splits a shell-like ssh_args string into tokens (supports single/double quotes). */
export function parseSSHArgs(text?: string): string[] {
  const s = (text || '').trim();
  if (!s) return [];
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | '' = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = '';
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur) {
        out.push(cur);
        cur = '';
      }
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function formatSSHArgs(args?: string[]): string {
  if (!args?.length) return '';
  return args.map((a) => (/\s/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(' ');
}

interface ZuluRemoteFieldsProps {
  agentType?: 'zulu' | 'claudecode';
  remoteOnly?: boolean;
  remoteHost: string;
  relayHost?: string;
  sshArgsText: string;
  workDir?: string;
  showWorkDir?: boolean;
  localWorkDirPlaceholder?: string;
  onChangeRemoteHost: (value: string) => void;
  onChangeRelayHost?: (value: string) => void;
  onChangeSSHArgsText: (value: string) => void;
  onChangeWorkDir?: (value: string) => void;
  testIdPrefix?: string;
}

export const supportsRemoteDevelopment = (agentType: string) => agentType === 'zulu' || agentType === 'claudecode';

export default function ZuluRemoteFields({
  agentType,
  remoteOnly = false,
  remoteHost,
  relayHost = '',
  sshArgsText,
  workDir = '',
  showWorkDir = false,
  localWorkDirPlaceholder = '/path/to/project',
  onChangeRemoteHost,
  onChangeRelayHost,
  onChangeSSHArgsText,
  onChangeWorkDir,
  testIdPrefix = 'zulu-remote',
}: ZuluRemoteFieldsProps) {
  const { i18n } = useTranslation();
  const zh = isZhLang(i18n.language || 'en');
  const cli = agentType === 'claudecode' ? 'Claude Code / ducc' : agentType === 'zulu' ? 'Zulu' : 'CLI';
  const hostListId = useId();
  const relayListId = useId();
  const [remoteMode, setRemoteMode] = useState(() => remoteOnly || !!remoteHost.trim());
  const [rememberedHost, setRememberedHost] = useState(remoteHost);
  const [rememberedRelay, setRememberedRelay] = useState(relayHost);
  const [sshHosts, setSshHosts] = useState<string[]>([]);
  const [relays, setRelays] = useState<string[]>([]);
  const [recentWorkspaces, setRecentWorkspaces] = useState<Record<string, string[]>>({});
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<SSHTestResult | null>(null);
  const [testError, setTestError] = useState('');

  useEffect(() => {
    if (remoteHost.trim()) {
      setRemoteMode(true);
      setRememberedHost(remoteHost);
    }
  }, [remoteHost]);

  useEffect(() => {
    if (relayHost.trim()) setRememberedRelay(relayHost);
  }, [relayHost]);

  useEffect(() => {
    if (!remoteMode) return;
    let alive = true;
    getSSHHosts()
      .then((r) => {
        if (!alive) return;
        setSshHosts(r.hosts || []);
        setRelays(r.relays || []);
        setRecentWorkspaces(r.recent_workspaces || {});
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [remoteMode]);

  const isLocalMacWorkDir = (dir: string) => {
    const d = dir.trim();
    return d.startsWith('/Users/') || d.startsWith('/Applications/');
  };

  const switchMode = (toRemote: boolean) => {
    setRemoteMode(toRemote);
    setTestResult(null);
    setTestError('');
    if (toRemote) {
      const target = remoteHost.trim() || rememberedHost.trim();
      if (!remoteHost.trim() && rememberedHost.trim()) {
        onChangeRemoteHost(rememberedHost.trim());
      }
      if (!relayHost.trim() && rememberedRelay.trim() && onChangeRelayHost) {
        onChangeRelayHost(rememberedRelay.trim());
      }
      if (onChangeWorkDir && isLocalMacWorkDir(workDir)) {
        const dirs = target ? recentWorkspaces[target] : undefined;
        onChangeWorkDir(dirs && dirs.length > 0 ? dirs[0] : '');
      }
    } else {
      if (remoteHost.trim()) setRememberedHost(remoteHost.trim());
      if (relayHost.trim()) setRememberedRelay(relayHost.trim());
      onChangeRemoteHost('');
      onChangeRelayHost?.('');
    }
  };

  const pickTargetHost = (h: string) => {
    setTestResult(null);
    setTestError('');
    onChangeRemoteHost(h);
    // If this target is an internal dev host (not itself a relay) and a relay is detected, auto-fill relay_host.
    if (onChangeRelayHost && !relayHost.trim() && !h.toLowerCase().includes('relay') && relays.length > 0) {
      const preferredRelay = relays.find((r) => r.includes('@')) || relays[0];
      onChangeRelayHost(preferredRelay);
    }
    // Auto-fill the most recent iDev remote workspace if workDir is empty or still a local macOS path.
    const dirs = recentWorkspaces[h];
    if (onChangeWorkDir && (!workDir.trim() || isLocalMacWorkDir(workDir)) && dirs && dirs.length > 0) {
      onChangeWorkDir(dirs[0]);
    }
  };

  const runTest = async () => {
    const host = remoteHost.trim();
    if (!host) return;
    setTesting(true);
    setTestResult(null);
    setTestError('');
    try {
      const res = await testSSHRemote({
        remote_host: host,
        agent_type: agentType,
        relay_host: relayHost.trim() || undefined,
        ssh_args: parseSSHArgs(sshArgsText),
        work_dir: workDir.trim() || undefined,
      });
      setTestResult(res);
    } catch (e: any) {
      setTestError(e?.message || String(e));
    } finally {
      setTesting(false);
    }
  };

  // Prefer non-relay targets for target quick-picks; fall back to all hosts if none.
  const targetSuggestions = sshHosts.filter((h) => !h.toLowerCase().includes('relay'));
  const shownTargets = targetSuggestions.length > 0 ? targetSuggestions : sshHosts;
  const hostRecentDirs = recentWorkspaces[remoteHost.trim()] || [];

  return (
    <div
      className="space-y-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-white/[0.02] p-3"
      data-testid={`${testIdPrefix}-panel`}
    >
      {!remoteOnly && <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
          {zh ? '运行环境' : 'Execution target'}
        </span>
        <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-0.5 text-xs">
          <button
            type="button"
            data-testid={`${testIdPrefix}-mode-local`}
            aria-pressed={!remoteMode}
            onClick={() => switchMode(false)}
            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 transition-colors ${
              !remoteMode
                ? 'bg-accent text-white dark:text-black font-medium'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            <Laptop size={12} />
            {zh ? '本机运行' : 'Local'}
          </button>
          <button
            type="button"
            data-testid={`${testIdPrefix}-mode-ssh`}
            aria-pressed={remoteMode}
            onClick={() => switchMode(true)}
            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 transition-colors ${
              remoteMode
                ? 'bg-accent text-white dark:text-black font-medium'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            <Server size={12} />
            {zh ? '远程 Linux 开发机 (SSH)' : 'Remote Linux (SSH)'}
          </button>
        </div>
      </div>}

      {!remoteOnly && !remoteMode ? (
        <div className="space-y-2">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {zh
              ? '在本机运行 CLI。'
              : 'Run the CLI on this machine.'}
          </p>
          {showWorkDir && onChangeWorkDir && (
            <Input
              label={zh ? '本机工作目录（可选）' : 'Local working directory (optional)'}
              data-testid={`${testIdPrefix}-local-workdir`}
              value={workDir}
              placeholder={localWorkDirPlaceholder}
              onChange={(e) => onChangeWorkDir(e.target.value)}
            />
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {zh
              ? '通过 SSH 在开发机运行 CLI，可选 Relay 跳板机。'
              : 'Run the CLI on the Linux host over SSH, optionally through a relay.'}
          </p>

          <div>
            <Input
              label={zh ? '远程开发机（user@host）' : 'Remote Linux host (user@host)'}
              data-testid={`${testIdPrefix}-host`}
              list={hostListId}
              value={remoteHost}
              placeholder={zh ? '例如 njjs 或 user@dev-host' : 'e.g. user@dev-host'}
              onChange={(e) => {
                setTestResult(null);
                setTestError('');
                onChangeRemoteHost(e.target.value);
              }}
            />
            <datalist id={hostListId}>
              {sshHosts.map((h) => (
                <option key={h} value={h} />
              ))}
            </datalist>
            {shownTargets.length > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                <span className="text-[11px] text-gray-400">{zh ? '发现开发机：' : 'Detected hosts:'}</span>
                {shownTargets.slice(0, 6).map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => pickTargetHost(h)}
                    className={`rounded-md border px-1.5 py-0.5 text-[11px] transition-colors ${
                      remoteHost.trim() === h
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-accent/50'
                    }`}
                  >
                    {h}
                  </button>
                ))}
              </div>
            )}
          </div>

          {onChangeRelayHost && (
            <div>
              <Input
                label={zh ? '跳板机 / Relay 主机（可选，直连留空）' : 'Relay host (optional, leave empty for direct SSH)'}
                data-testid={`${testIdPrefix}-relay`}
                list={relayListId}
                value={relayHost}
                placeholder={zh ? '例如 relay 或 user@relay.example.com' : 'e.g. user@relay.example.com'}
                onChange={(e) => {
                  setTestResult(null);
                  setTestError('');
                  onChangeRelayHost(e.target.value);
                }}
              />
              <datalist id={relayListId}>
                {relays.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
              {relays.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  <span className="text-[11px] text-gray-400">{zh ? '发现跳板机：' : 'Detected relays:'}</span>
                  {relays.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => {
                        setTestResult(null);
                        setTestError('');
                        onChangeRelayHost(r);
                      }}
                      className={`rounded-md border px-1.5 py-0.5 text-[11px] transition-colors ${
                        relayHost.trim() === r
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-accent/50'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                  {relayHost.trim() && (
                    <button
                      type="button"
                      onClick={() => onChangeRelayHost('')}
                      className="rounded-md border border-gray-200 dark:border-gray-700 px-1.5 py-0.5 text-[11px] text-gray-400 hover:text-gray-600"
                    >
                      {zh ? '直连（清空）' : 'Direct'}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {showWorkDir && onChangeWorkDir && (
            <div>
              <Input
                label={zh ? '远程 Linux 工作目录' : 'Remote Linux working directory'}
                data-testid={`${testIdPrefix}-workdir`}
                value={workDir}
                placeholder="/home/work/your-repo"
                onChange={(e) => {
                  setTestResult(null);
                  onChangeWorkDir(e.target.value);
                }}
              />
              {hostRecentDirs.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  <span className="text-[11px] text-gray-400">{zh ? 'iDev 最近目录：' : 'Recent:'}</span>
                  {hostRecentDirs.slice(0, 4).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => onChangeWorkDir(d)}
                      className={`rounded-md border px-1.5 py-0.5 text-[11px] font-mono transition-colors ${
                        workDir.trim() === d
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-accent/50'
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {!showWorkDir && onChangeWorkDir && hostRecentDirs.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[11px] text-gray-400">{zh ? 'iDev 最近远端目录：' : 'Recent remote dirs:'}</span>
              {hostRecentDirs.slice(0, 4).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => onChangeWorkDir(d)}
                  className={`rounded-md border px-1.5 py-0.5 text-[11px] font-mono transition-colors ${
                    workDir.trim() === d
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-accent/50'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          )}

          <Input
            label={zh ? 'SSH 附加参数（可选，空格分隔）' : 'Extra SSH args (optional, space-separated)'}
            data-testid={`${testIdPrefix}-ssh-args`}
            value={sshArgsText}
            placeholder="-p 2222 -o ControlMaster=auto"
            onChange={(e) => {
              setTestResult(null);
              setTestError('');
              onChangeSSHArgsText(e.target.value);
            }}
          />

          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!remoteHost.trim() || testing}
              data-testid={`${testIdPrefix}-test`}
              onClick={runTest}
            >
              {testing ? <Loader2 size={12} className="animate-spin" /> : null}
              {testing
                ? zh
                  ? `正在探测 SSH 与远程 ${cli}…`
                  : `Testing SSH and remote ${cli}…`
                : zh
                  ? `测试 SSH 与远程 ${cli}`
                  : `Test SSH and remote ${cli}`}
            </Button>
          </div>

          {testError && (
            <p className="flex items-start gap-1 text-xs text-red-500" data-testid={`${testIdPrefix}-test-error`}>
              <XCircle size={13} className="mt-0.5 shrink-0" />
              <span>{testError}</span>
            </p>
          )}
          {testResult && testResult.ok && (
            <div
              className="space-y-0.5 rounded-lg border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/70 dark:bg-emerald-950/30 p-2 text-xs text-emerald-700 dark:text-emerald-300"
              data-testid={`${testIdPrefix}-test-ok`}
            >
              <p className="flex items-center gap-1 font-medium">
                <CheckCircle2 size={13} />
                {zh ? `SSH 与远程 ${cli} 探测通过` : `SSH and remote ${cli} verified`}
                
              </p>
              {[testResult.ducc_path, testResult.zulu_path].filter(Boolean).map((path) => (
                <p key={path} className="truncate font-mono text-[11px] opacity-80">{path}</p>
              ))}
              {testResult.work_dir_ok === true && workDir.trim() && (
                <p className="text-[11px]">
                  {zh ? `远端目录存在：${workDir.trim()}` : `Remote directory exists: ${workDir.trim()}`}
                </p>
              )}
            </div>
          )}
          {testResult && !testResult.ok && (
            <div
              className="space-y-0.5 rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50/70 dark:bg-amber-950/30 p-2 text-xs text-amber-800 dark:text-amber-300"
              data-testid={`${testIdPrefix}-test-fail`}
            >
              <p className="flex items-start gap-1 font-medium">
                <XCircle size={13} className="mt-0.5 shrink-0 text-red-500" />
                <span>{testResult.error || (zh ? '远端探测失败' : 'Remote probe failed')}</span>
              </p>
              {testResult.ducc_path && (
                <p className="truncate font-mono text-[11px] opacity-80">ducc: {testResult.ducc_path}</p>
              )}
              {testResult.zulu_path && (
                <p className="truncate font-mono text-[11px] opacity-80">zulu: {testResult.zulu_path}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
