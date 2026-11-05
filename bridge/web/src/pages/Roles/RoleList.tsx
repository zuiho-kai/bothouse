import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RotateCw,
  Pause,
  Play,
  Bot,
  Layers,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { Button, EmptyState, Modal } from '@/components/ui';
import { cn } from '@/lib/utils';
import { listRoles, restartRole, setRolePaused, type RoleInfo } from '@/api/roles';
import { DSHNotice } from '@/components/DSHNotice';
import { roleLabel } from '@/lib/roleIdentity';
import { dshMemberId, dshOnlyRows } from '@/lib/dshMerge';
import { shownName } from '@/api/projects';
import { deleteDSHMember, listDSHMembers, type DSHManagedMember } from '@/api/dsh';
import { errorMessage } from '@/components/DSHNotice';
import { usePageRefresh } from '@/lib/usePageRefresh';
import { DSHMemberEditor } from './DSHMemberEditor';

/** 角色四态：在忙 / 空闲 / 不在线 / 已暂停。
 *  房规（taste-skill app-screens §9.2）：一屏只留一个强调色家族，颜色给数据不给 chrome；
 *  所以只有「在忙」（这一屏真正要看的数据）吃 accent，暂停和掉线是状态不是警报，走 ink 灰阶。 */
type RoleTone = { label: string; dot: string; pill: string; ring: string };

function roleStateOf(role: RoleInfo): RoleTone {
  if (role.paused) {
    return {
      label: '已暂停',
      dot: 'bg-ink-mute',
      pill: 'text-ink-soft border-hairline-strong',
      ring: 'border-hairline',
    };
  }
  if (!role.online) {
    return {
      label: '不在线',
      dot: 'bg-transparent border border-ink-mute',
      pill: 'text-ink-mute border-hairline',
      ring: 'border-hairline',
    };
  }
  if (role.busy) {
    return {
      label: '在忙',
      dot: 'bg-accent',
      pill: 'text-accent bg-accent-wash border-accent/25',
      ring: 'border-hairline',
    };
  }
  return {
    label: '空闲',
    dot: 'bg-ink-soft',
    pill: 'text-ink-soft bg-surface-sunken border-hairline',
    ring: 'border-hairline',
  };
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
  const memberActions = (member?: DSHManagedMember) => member ? <div className="mt-4 space-y-2 border-t border-hairline pt-3">
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
  </div> : <p className="mt-4 border-t border-hairline pt-3 text-xs text-ink-mute">{t('dshManage.unavailable')}</p>;

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
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-ink">{t('roles.title', '角色管理')}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {t('roles.subtitle', '查看每个角色的在线状态、当前工作、模型并进行控制')}
          </p>
          {roles.length > 0 && (
            <p className="mt-2 text-xs text-ink-mute tabular-nums">
              {counts.busy} 个在忙 · {counts.idle} 个空闲 · {counts.offline} 个不在线
              {counts.paused > 0 ? ` · ${counts.paused} 个已暂停` : ''}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => setEditor('new')}>{t('dshManage.add')}</Button><Button
          variant="secondary"
          size="sm"
          onClick={fetchRoles}
          disabled={loading}
          className="gap-2 self-start"
        >
          <RotateCw size={14} className={cn(loading && 'animate-spin motion-reduce:animate-none')} />
          {t('common.refresh', '刷新')}
        </Button></div>
      </header>

      <DSHNotice status={dsh?.status} error={dsh?.error} />
      {memberError && <p role="alert" className="text-sm text-red-600">{t('dshManage.rosterError')}: {memberError}</p>}
      {msg && (
        <div className="flex items-center gap-2 rounded-control border border-hairline bg-surface-sunken px-3 py-2 text-sm text-ink">
          <CheckCircle2 size={15} className="shrink-0 text-accent" />
          <span className="min-w-0">{msg}</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-control border border-red-500/25 bg-red-500/[0.06] px-3 py-2 text-sm text-red-700 dark:text-red-400">
          <AlertCircle size={15} className="shrink-0" />
          <span className="min-w-0">{error}</span>
        </div>
      )}

      {loading && roles.length === 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3" aria-hidden>
          {Array.from({ length: SKELETON_SEATS }).map((_, i) => (
            <div key={i} className="h-[188px] rounded-card bg-surface-sunken border border-hairline" />
          ))}
        </div>
      ) : roles.length === 0 ? (
        <div className="rounded-card bg-surface p-8 border border-hairline">
          <EmptyState icon={Bot} message={t('roles.noRoles', '暂无角色配置')} />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {roles.map((role) => {
            const isRestarting = !!actionLoading[`restart-${role.name}`];
            const isPausing = !!actionLoading[`pause-${role.name}`];
            const shown = shownName(role);
            const state = roleStateOf(role);

            return (
              <article
                key={role.name}
                className={cn(
                  'flex flex-col rounded-card bg-surface p-5 border',
                  'transition-colors duration-state ease-ui-standard',
                  state.ring,
                )}
              >
                {/* 名字 + 标识 + 状态词。不做首字母彩块或描边方托：每个对象都带同一枚装饰，正是被点名的模板痕迹。 */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold text-ink">
                      {roleLabel(shown, role.agent_type)}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-mute">
                      <Bot size={11} className="shrink-0" />
                      <span className="truncate">{role.agent_type}</span>
                      {shown !== role.name && role.source !== 'dsh' && (
                        // 标识符（不是正文），mono 是它的正确排法
                        <span className="hidden truncate font-mono sm:inline">{role.name}</span>
                      )}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium border',
                      state.pill,
                    )}
                  >
                    <span className={cn('h-1.5 w-1.5 rounded-full', state.dot)} />
                    {state.label}
                  </span>
                </div>

                {/* 三个字段按 dl 排，行线是真实字段分隔，不是装饰 */}
                <dl className="mt-4 divide-y divide-hairline">
                  <div className="flex items-baseline justify-between gap-3 py-2">
                    <dt className="shrink-0 text-xs text-ink-mute">当前在忙</dt>
                    <dd
                      className={cn(
                        'min-w-0 truncate text-right text-[13px] font-medium',
                        role.online && role.busy ? 'text-ink' : 'text-ink-soft',
                      )}
                    >
                      {role.current_task || '—'}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 py-2">
                    <dt className="shrink-0 text-xs text-ink-mute">当前模型</dt>
                    <dd className="min-w-0 truncate text-right font-mono text-xs text-ink-soft">
                      {role.model || t('dsh.unknownModel', '未知')}
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-3 py-2">
                    <dt className="shrink-0 text-xs text-ink-mute">连接平台</dt>
                    <dd className="flex min-w-0 flex-wrap justify-end gap-x-2.5 gap-y-1 text-right text-xs text-ink-soft">
                      {role.platforms && role.platforms.length > 0 ? (
                        role.platforms.map((p) => (
                          <span key={p.name} className="inline-flex items-center gap-1">
                            <span className={cn('h-1 w-1 rounded-full', p.ready ? 'bg-accent' : 'bg-ink-mute')} />
                            {p.name}
                          </span>
                        ))
                      ) : (
                        <span className="text-ink-mute">无</span>
                      )}
                    </dd>
                  </div>
                </dl>

                {role.platforms?.filter((p) => p.notice).map((p) => (
                  <p key={'notice-' + p.name} className="mt-2 text-xs leading-relaxed text-amber-600">
                    {p.notice}
                  </p>
                ))}

                {role.source === 'dsh' ? (
                  memberActions(members.find(m => m.id === dshMemberId(role.name)))
                ) : (
                <div className="mt-4 flex items-center gap-2 border-t border-hairline pt-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1 gap-1.5"
                    onClick={() => handleTogglePause(role)}
                    disabled={isPausing}
                  >
                    {role.paused ? <Play size={13} /> : <Pause size={13} />}
                    {role.paused ? '恢复' : '暂停'}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1 gap-1.5"
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
        <h2 className="text-sm font-semibold text-ink">{t('dshManage.otherMembers')}</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">{extraMembers.map(m => <article key={m.id} className="rounded-card border border-hairline bg-surface p-5"><p className="font-semibold">{m.name}</p>{memberActions(m)}</article>)}</div>
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
