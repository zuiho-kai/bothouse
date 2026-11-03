import { useEffect, useState, useCallback } from 'react';
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
import { Button, EmptyState } from '@/components/ui';
import { cn } from '@/lib/utils';
import { listRoles, restartRole, setRolePaused, type RoleInfo } from '@/api/roles';
import { roleLabel } from '@/lib/roleIdentity';
import { shownName } from '@/api/projects';

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
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const fetchRoles = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await listRoles();
      setRoles(res.roles || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load roles');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRoles();
  }, [fetchRoles]);

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
        <Button
          variant="secondary"
          size="sm"
          onClick={fetchRoles}
          disabled={loading}
          className="gap-2 self-start"
        >
          <RotateCw size={14} className={cn(loading && 'animate-spin motion-reduce:animate-none')} />
          {t('common.refresh', '刷新')}
        </Button>
      </header>

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
                      {shown !== role.name && (
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
                      {role.model || '—'}
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
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}