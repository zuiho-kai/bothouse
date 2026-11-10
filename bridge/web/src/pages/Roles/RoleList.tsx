import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RotateCw,
  Pause,
  Play,
  Bot,
  Layers,
  Gauge,
  Plus,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import { Button, EmptyState, Modal, Badge, RoleAvatar, StatePill, roleState, ROLE_STATE_LABEL, type RoleState } from '@/components/ui';
import { cn } from '@/lib/utils';
import { listRoles, restartRole, setRolePaused, type RoleInfo } from '@/api/roles';
import { DSHNotice } from '@/components/DSHNotice';
import { backendLabel } from '@/lib/roleIdentity';
import { dshMemberId, dshOnlyRows } from '@/lib/dshMerge';
import { shownName } from '@/api/projects';
import { deleteDSHMember, listDSHMembers, type DSHManagedMember } from '@/api/dsh';
import { errorMessage } from '@/components/DSHNotice';
import { usePageRefresh } from '@/lib/usePageRefresh';
import { DSHMemberEditor } from './DSHMemberEditor';
import { LibraryAvatar } from '@/components/library/LibraryAvatar';

function isServerMembersIntentNotice(notice: string): boolean {
  return (
    /server_members_intent/i.test(notice) ||
    /SERVER MEMBERS INTENT/i.test(notice) ||
    /Server Members Intent/i.test(notice)
  );
}

/* 骨架卡的张数 = 下面网格的列数 × 2 行（lg 三列），先占住首屏的高度，加载完不跳。 */
const SKELETON_SEATS = 6;

export default function RoleList() {
  const { t } = useTranslation();
  const [dsh, setDsh] = useState<{ status: 'running' | 'stopped' | 'error'; error?: string }>();
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [members, setMembers] = useState<DSHManagedMember[]>([]);
  const [memberError, setMemberError] = useState('');
  const [editor, setEditor] = useState<DSHManagedMember | 'new' | null>(null);
  const [deleteMember, setDeleteMember] = useState<DSHManagedMember | null>(null);
  const [deleting, setDeleting] = useState(false);
  // #579 v2: filter by state; 'all' keeps the old full grid
  const [filter, setFilter] = useState<RoleState | 'all'>('all');
  const requestId = useRef(0);
  const loaded = useRef(false);

  const fetchRoles = useCallback(async () => {
    const request = ++requestId.current;
    try {
      if (!loaded.current) setLoading(true);
      setError('');
      const [res, roster] = await Promise.all([listRoles(), listDSHMembers().then(value => ({ value })).catch(error => ({ error }))]);
      if (request !== requestId.current) return;
      if ('error' in roster) { setMembers([]); setMemberError(errorMessage(roster.error)); }
      else { setMembers(roster.value.members); setMemberError(''); }
      const all = res.roles || [];
      // Keep bridge controls when DSH reports the same registered bot.
      setRoles(dshOnlyRows(all, all.filter((r) => r.source !== 'dsh').map((r) => r.name)));
      setDsh(res.dsh);
    } catch (e: any) {
      if (request === requestId.current) setError(e.message || 'Failed to load roles');
    } finally {
      if (request === requestId.current) { loaded.current = true; setLoading(false); }
    }
  }, []);

  usePageRefresh(fetchRoles);
  useEffect(() => () => { requestId.current++; }, []);
  const changed = () => { setEditor(null); setDeleteMember(null); window.dispatchEvent(new CustomEvent('cc:refresh')); };
  const removeMember = async () => {
    if (!deleteMember) return;
    setDeleting(true); setError('');
    try { await deleteDSHMember(deleteMember.id); changed(); }
    catch (e) { setError(errorMessage(e)); }
    finally { setDeleting(false); }
  };
  const memberActions = (member?: DSHManagedMember) => member ? <div className="mt-auto space-y-2 border-t border-hairline pt-3">
    <p className="text-xs text-ink-mute">{t('dshManage.source')}: {member.source} · {t(`dshManage.apply_${member.apply.status}`)}{member.apply.error ? `: ${member.apply.error}` : ''}</p>
    {member.source === 'ui' && (member.can_edit || member.can_delete) && member.cli === 'codex' && (member.cliConfig?.model || member.cliConfig?.reasoningEffort) && <div className="space-y-1 text-xs text-ink-soft">
      <p className="text-ink-mute">{t('dshManage.savedConfigNextTurn')}</p>
      {member.cliConfig.model && <p className="break-all">{t('dshManage.model')}: {member.cliConfig.model}</p>}
      {member.cliConfig.reasoningEffort && <p className="break-all">{t('dshManage.effort')}: {member.cliConfig.reasoningEffort}</p>}
    </div>}
    {member.source === 'ui' && (member.can_edit || member.can_delete) && !member.cli && member.model && <div className="space-y-1 text-xs text-ink-soft">
      <p className="text-ink-mute">{t('dshManage.savedRoute')}</p>
      <p className="break-all">{t('dshManage.provider')}: {member.model.provider}</p>
      <p className="break-all">{t('dshManage.model')}: {member.model.model}</p>
    </div>}
    {member.source === 'ui' && (member.can_edit || member.can_delete) ? <div className="flex flex-wrap gap-2">
      {member.can_edit && <Button variant="secondary" size="sm" onClick={() => setEditor(member)}>{t('dshManage.edit')}</Button>}
      {member.can_delete && <Button variant="secondary" size="sm" onClick={() => setDeleteMember(member)}>{t('dshManage.delete')}</Button>}
    </div> : <p className="text-xs text-ink-mute">{t('dshManage.readOnly')}</p>}
  </div> : <p className="mt-auto border-t border-hairline pt-3 text-xs text-ink-mute">{t('dshManage.unavailable')}</p>;

  const handleRestart = async (name: string) => {
    try {
      setActionLoading((prev) => ({ ...prev, [`restart-${name}`]: true }));
      setMsg('');
      const res = await restartRole(name);
      setMsg(res.message || `Role ${shownName(roles.find((r) => r.name === name)) || name} restarted`);
      await fetchRoles();
    } catch (e: any) {
      setError(e.message || 'Restart failed');
    } finally {
      setActionLoading((prev) => ({ ...prev, [`restart-${name}`]: false }));
    }
  };

  const handleTogglePause = async (role: RoleInfo) => {
    try {
      setActionLoading((prev) => ({ ...prev, [`pause-${role.name}`]: true }));
      setMsg('');
      const targetPaused = !role.paused;
      const res = await setRolePaused(role.name, targetPaused);
      setMsg(res.message || `Role ${shownName(role)} updated`);
      await fetchRoles();
    } catch (e: any) {
      setError(e.message || 'Toggle pause failed');
    } finally {
      setActionLoading((prev) => ({ ...prev, [`pause-${role.name}`]: false }));
    }
  };

  // 这一屏的「一个发现」：谁在忙、谁掉线，写在标题下面一行，别让它埋在卡片里。
  const counts = roles.reduce(
    (acc, r) => {
      if (r.paused) acc.paused += 1;
      else if (!r.online) acc.offline += 1;
      else if (r.busy) acc.busy += 1;
      else acc.idle += 1;
      return acc;
    },
    { busy: 0, idle: 0, offline: 0, paused: 0 }
  );

  const extraMembers = members.filter(m => !roles.some(r => r.source === 'dsh' ? dshMemberId(r.name) === m.id : r.name === m.id));
  const shownRoles = filter === 'all' ? roles : roles.filter((r) => roleState(r) === filter);
  const filters: { key: RoleState | 'all'; n: number }[] = [
    { key: 'all', n: roles.length },
    { key: 'busy', n: counts.busy },
    { key: 'idle', n: counts.idle },
    { key: 'offline', n: counts.offline },
    ...(counts.paused > 0 ? [{ key: 'paused' as const, n: counts.paused }] : []),
  ];
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-ink">{t('roles.title', '角色管理')}</h1>
          <p className="mt-1.5 text-sm text-ink-soft">
            {t('roles.subtitle', '查看每个角色的在线状态、当前工作、模型并进行控制')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setEditor('new')} className="gap-1.5"><Plus size={14} />{t('dshManage.add')}</Button>
          <Button variant="secondary" size="sm" onClick={fetchRoles} disabled={loading} className="gap-2 self-start">
            <RotateCw size={14} className={cn(loading && 'animate-spin motion-reduce:animate-none')} />
            {t('common.refresh', '刷新')}
          </Button>
        </div>
      </header>

      {roles.length > 0 && (
        // 这一屏的「一个发现」：谁在忙、谁掉线，做成可点的筛选，而不是埋在标题下的一行小字。
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="tablist" aria-label={t('roles.title', '角色管理')}>
          {filters.map(({ key, n }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              onClick={() => setFilter(key)}
              className={cn(
                'flex h-9 shrink-0 items-center gap-2 rounded-pill px-3.5 text-[13px] font-medium transition-colors duration-base',
                filter === key ? 'bg-ink text-canvas' : 'bg-surface text-ink-soft shadow-ui-1 hover:text-ink',
              )}
            >
              {key === 'all' ? t('roles.all', '全部') : ROLE_STATE_LABEL[key]}
              <span className={cn('tabular-nums', filter === key ? 'opacity-70' : 'text-ink-mute')}>{n}</span>
            </button>
          ))}
        </div>
      )}

      <DSHNotice status={dsh?.status} error={dsh?.error} />
      {/* DSH 没在跑或读不到时，上面那条已经把原因说清了，成员管理这里不再重复同一句话（#226）。 */}
      {memberError && dsh?.status === 'running' && <p role="alert" className="text-sm text-red-600">{t('dshManage.rosterError')}: {memberError}</p>}
      {msg && (
        <div className="flex items-center gap-2 rounded-card bg-surface px-4 py-2.5 text-sm text-ink shadow-ui-1">
          <CheckCircle2 size={15} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span className="min-w-0">{msg}</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-card border border-red-500/25 bg-red-500/[0.06] px-4 py-2.5 text-sm text-red-700 dark:text-red-400">
          <AlertCircle size={15} className="shrink-0" />
          <span className="min-w-0">{error}</span>
        </div>
      )}

      {loading && roles.length === 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-hidden>
          {Array.from({ length: SKELETON_SEATS }).map((_, i) => (
            <div key={i} className="h-[220px] animate-pulse rounded-card bg-surface shadow-ui-1" />
          ))}
        </div>
      ) : roles.length === 0 ? (
        <div className="rounded-card bg-surface p-8 shadow-ui-1">
          <EmptyState icon={Bot} message={t('roles.noRoles', '暂无角色配置')} />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shownRoles.map((role) => {
            const isRestarting = !!actionLoading[`restart-${role.name}`];
            const isPausing = !!actionLoading[`pause-${role.name}`];
            const shown = shownName(role);
            const state = roleState(role);
            const busy = state === 'busy';

            return (
              <article
                key={role.name}
                className={cn(
                  'group/card flex flex-col gap-4 rounded-card bg-surface p-5 shadow-ui-1',
                  'transition-shadow duration-state ease-ui-standard hover:shadow-ui-2',
                  busy && 'ring-1 ring-accent/30',
                )}
              >
                {/* 头像 + 名字 + 状态：一眼认人 */}
                <div className="flex items-start gap-3">
                  <RoleAvatar name={shown} state={state} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-semibold leading-6 text-ink">{shown}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-mute">
                      <span className="truncate">{backendLabel(role.agent_type)}</span>
                      {shown !== role.name && role.source !== 'dsh' && (
                        <span className="hidden truncate font-mono sm:inline">· {role.name}</span>
                      )}
                    </p>
                  </div>
                  <StatePill state={state} />
                </div>

                {/* 当前在做的事：卡片的主角 */}
                <div className={cn('rounded-[12px] px-3.5 py-3', busy ? 'bg-accent-wash' : 'bg-surface-sunken')}>
                  <p className={cn('text-[11px] font-semibold uppercase tracking-wider', busy ? 'text-accent-text' : 'text-ink-mute')}>{busy ? '正在做' : '当前'}</p>
                  <p className={cn('mt-1 line-clamp-2 text-sm leading-5', busy ? 'font-medium text-ink' : 'text-ink-mute')}>
                    {role.current_task || (state === 'idle' ? '空闲，等新消息' : state === 'paused' ? '已暂停' : '—')}
                  </p>
                </div>

                {/* 型号和平台降成一行小字；行线是真实字段分隔，不是装饰 */}
                <dl className="space-y-1.5 text-xs">
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="shrink-0 text-ink-mute">当前模型</dt>
                    <dd className="min-w-0 truncate text-right font-mono text-[11px] text-ink-soft">
                      {role.model || t('dsh.unknownModel', '未知')}
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <dt className="shrink-0 text-ink-mute">连接平台</dt>
                    <dd className="flex min-w-0 flex-wrap justify-end gap-x-2.5 gap-y-1 text-right text-ink-soft">
                      {role.platforms && role.platforms.length > 0 ? (
                        role.platforms.map((p) => {
                          const notice = p.notice;
                          const isIntentNotice = notice ? isServerMembersIntentNotice(notice) : false;
                          let fixUrl: string | null = null;
                          let description = '';
                          if (isIntentNotice && notice) {
                            const urlMatch = notice.match(/https?:\/\/[^\s]+/);
                            fixUrl = urlMatch ? urlMatch[0] : null;
                            description = fixUrl ? notice.replace(fixUrl, '').trim() : notice;
                          }

                          return (
                            <span key={p.name} className="inline-flex items-center gap-1.5">
                              <span className={cn('h-1.5 w-1.5 rounded-full', p.ready ? 'bg-emerald-500' : 'bg-ink-mute')} />
                              <span>{p.name}</span>
                              {isIntentNotice && (
                                <span className="group relative inline-flex items-center">
                                  <button
                                    type="button"
                                    className="inline-flex items-center gap-1 rounded-pill text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                                    aria-label={`${t('roles.membersIntentOff', '未开成员事件')}: ${description}`}
                                  >
                                    <Badge
                                      variant="warning"
                                      className="cursor-help px-1.5 py-0 text-[10px] font-normal"
                                    >
                                      {t('roles.membersIntentOff', '未开成员事件')}
                                    </Badge>
                                  </button>
                                  <div
                                    role="tooltip"
                                    className="pointer-events-none absolute bottom-full right-0 z-50 mb-1.5 hidden w-72 max-w-[calc(100vw-3rem)] flex-col rounded-card border border-hairline bg-surface p-3 text-left text-xs leading-relaxed text-ink shadow-ui-2 transition-all duration-base before:absolute before:inset-x-0 before:-bottom-2 before:h-2 group-hover:pointer-events-auto group-hover:flex group-focus-within:pointer-events-auto group-focus-within:flex"
                                  >
                                    <p className="select-text whitespace-normal text-ink-soft">{description}</p>
                                    {fixUrl && (
                                      <a
                                        href={fixUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="mt-2.5 inline-flex items-center gap-1 font-medium text-accent-text hover:underline select-text"
                                      >
                                        <span>{t('roles.openDeveloperPortal', '打开 Discord 开发者后台')}</span>
                                        <ExternalLink size={12} className="shrink-0" />
                                      </a>
                                    )}
                                  </div>
                                </span>
                              )}
                            </span>
                          );
                        })
                      ) : (
                        <span className="text-ink-mute">无</span>
                      )}
                    </dd>
                  </div>
                  {role.quota?.windows && role.quota.windows.length > 0 && (
                    <div className="pt-1.5" data-testid={`role-quota-${role.name}`}>
                      <dt className="flex items-center justify-between text-ink-mute">
                        <span className="flex items-center gap-1.5">
                          <Gauge size={12} className="shrink-0" />
                          模型额度：
                        </span>
                        <span className="text-[10px]">（剩余口径）</span>
                      </dt>
                      <dd className="mt-1.5 space-y-1.5">
                        {role.quota.windows.map((w, idx) => {
                          const remaining = Math.max(0, Math.min(100, w.remaining_percent));
                          const used = Math.max(0, Math.min(100, w.used_percent));
                          return (
                            <div key={w.name || idx} className="space-y-1" data-testid={`quota-window-${w.label || idx}`}>
                              <div className="flex items-baseline justify-between text-[11px]">
                                <span className="text-ink-soft">{w.label || w.name}</span>
                                <span className="font-mono text-[10px] text-ink-soft">
                                  剩 {remaining}% <span className="text-ink-mute">/ 已用 {used}%</span>
                                </span>
                              </div>
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
                                <div className={cn('h-full rounded-full', remaining < 20 ? 'bg-amber-500' : 'bg-accent')} style={{ width: `${remaining}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </dd>
                    </div>
                  )}
                </dl>

                {role.platforms
                  ?.filter((p) => p.notice && !isServerMembersIntentNotice(p.notice))
                  .map((p) => (
                    <p key={'notice-' + p.name} className="-mt-1 rounded-control bg-amber-500/[0.08] px-3 py-2 text-xs leading-relaxed text-amber-600">
                      {p.notice}
                    </p>
                  ))}

                {role.source === 'dsh' ? (
                  memberActions(members.find(m => m.id === dshMemberId(role.name)))
                ) : (
                <div className="mt-auto flex items-center justify-end gap-1 border-t border-hairline pt-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => handleTogglePause(role)}
                    disabled={isPausing}
                  >
                    {role.paused ? <Play size={13} /> : <Pause size={13} />}
                    {role.paused ? '恢复' : '暂停'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => handleRestart(role.name)}
                    disabled={isRestarting}
                  >
                    <RotateCw size={13} className={cn(isRestarting && 'animate-spin motion-reduce:animate-none')} />
                    重启
                  </Button>
                </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      {extraMembers.length > 0 && <section className="space-y-3">
        <h2 className="px-1 text-[13px] font-semibold uppercase tracking-wider text-ink-mute">{t('dshManage.otherMembers')}</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{extraMembers.map(m => <article key={m.id} className="flex flex-col gap-4 rounded-card bg-surface p-5 shadow-ui-1"><div className="flex items-center gap-3"><LibraryAvatar name={m.name} size={40} /><p className="font-semibold text-ink">{m.name}</p></div>{memberActions(m)}</article>)}</div>
      </section>}
      {editor && <DSHMemberEditor member={editor === 'new' ? null : editor} onClose={() => setEditor(null)} onSaved={changed} />}
      <Modal open={!!deleteMember} onClose={() => setDeleteMember(null)} title={t('dshManage.delete')}>
        <p className="text-sm text-ink-soft">{t('dshManage.deleteConfirm', { name: deleteMember?.name })}</p>
        {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={() => setDeleteMember(null)}>{t('common.cancel')}</Button><Button disabled={deleting} onClick={removeMember}>{t('dshManage.delete')}</Button></div>
      </Modal>
    </div>
  );
}
