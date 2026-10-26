import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Users,
  RotateCw,
  Pause,
  Play,
  Activity,
  Bot,
  Cpu,
  Layers,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { Card, Badge, Button, EmptyState } from '@/components/ui';
import { listRoles, restartRole, setRolePaused, type RoleInfo } from '@/api/roles';
import { roleLabel } from '@/lib/roleIdentity';
import { shownName } from '@/api/projects';

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

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Users size={22} className="text-accent" />
            {t('roles.title', '角色管理')}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t('roles.subtitle', '查看每个角色的在线状态、当前工作、模型并进行控制')}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={fetchRoles} disabled={loading} className="gap-2 self-start">
          <RotateCw size={14} className={loading ? 'animate-spin' : ''} />
          {t('common.refresh', '刷新')}
        </Button>
      </div>

      {msg && (
        <div className="p-3 text-sm rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 flex items-center gap-2">
          <CheckCircle2 size={16} />
          <span>{msg}</span>
        </div>
      )}

      {error && (
        <div className="p-3 text-sm rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800 flex items-center gap-2">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {loading && roles.length === 0 ? (
        <div className="flex items-center justify-center h-64 text-gray-400">
          <Activity className="animate-pulse" size={24} />
        </div>
      ) : roles.length === 0 ? (
        <div className="rounded-xl border border-gray-200/80 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-8">
          <EmptyState
            icon={Bot}
            message={t('roles.noRoles', '暂无角色配置')}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {roles.map((role) => {
            const isRestarting = !!actionLoading[`restart-${role.name}`];
            const isPausing = !!actionLoading[`pause-${role.name}`];
            const shown = shownName(role);

            return (
              <Card key={role.name} className="flex flex-col justify-between p-5 hover:border-accent/40 transition-all">
                <div className="space-y-4">
                  {/* Top: Name & Badges */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-xl bg-accent/10 dark:bg-accent/20 text-accent flex items-center justify-center font-bold text-base">
                        {Array.from(shown).slice(0, 2).join('').toUpperCase()}
                      </div>
                      <div>
                        <div className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                          <span>{roleLabel(shown, role.agent_type)}</span>
                          {shown !== role.name && (
                            <span className="text-[11px] font-normal font-mono text-gray-400">{role.name}</span>
                          )}
                          {role.paused && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20">
                              已暂停
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                          <Bot size={12} />
                          {role.agent_type}
                        </span>
                      </div>
                    </div>

                    {/* Online status */}
                    <Badge variant={role.online ? 'success' : 'default'} className="gap-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${role.online ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                      {role.online ? '在线' : '离线'}
                    </Badge>
                  </div>

                  {/* 4 Required items: Status, Current task, Current model, Controls */}
                  <div className="space-y-2.5 text-xs bg-gray-50/70 dark:bg-white/[0.02] p-3 rounded-lg border border-gray-100 dark:border-white/[0.04]">
                    {/* Current task */}
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                        <Activity size={13} className="text-gray-400" />
                        当前在忙：
                      </span>
                      <span className={`font-medium max-w-[150px] truncate ${role.busy ? 'text-amber-500' : 'text-gray-700 dark:text-gray-300'}`}>
                        {role.current_task}
                      </span>
                    </div>

                    {/* Model */}
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                        <Cpu size={13} className="text-gray-400" />
                        当前模型：
                      </span>
                      <span className="font-mono text-[11px] text-gray-800 dark:text-gray-200 bg-gray-200/50 dark:bg-white/[0.06] px-1.5 py-0.5 rounded">
                        {role.model || '-'}
                      </span>
                    </div>

                    {/* Platforms */}
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-gray-500 dark:text-gray-400 flex items-center gap-1.5 shrink-0">
                        <Layers size={13} className="text-gray-400" />
                        连接平台：
                      </span>
                      <div className="flex flex-wrap gap-1.5 justify-end">
                        {role.platforms && role.platforms.length > 0 ? (
                          role.platforms.map((p) => (
                            <span
                              key={p.name}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/[0.05] text-[11px] text-gray-700 dark:text-gray-300"
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${p.ready ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                              {p.name}
                            </span>
                          ))
                        ) : (
                          <span className="text-gray-400">无</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Actions: Restart & Pause Buttons */}
                <div className="flex items-center gap-2 pt-4 border-t border-gray-100 dark:border-white/[0.06] mt-4">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1 gap-1.5 text-xs"
                    onClick={() => handleTogglePause(role)}
                    disabled={isPausing}
                  >
                    {role.paused ? <Play size={13} className="text-emerald-500" /> : <Pause size={13} className="text-amber-500" />}
                    {role.paused ? '恢复' : '暂停'}
                  </Button>

                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1 gap-1.5 text-xs"
                    onClick={() => handleRestart(role.name)}
                    disabled={isRestarting}
                  >
                    <RotateCw size={13} className={isRestarting ? 'animate-spin' : ''} />
                    重启
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
