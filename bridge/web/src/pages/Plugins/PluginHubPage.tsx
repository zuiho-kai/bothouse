import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Boxes,
  RotateCw,
  Coffee,
  Flame,
  HelpCircle,
  PartyPopper,
  AlertTriangle,
  MessageSquare,
  Package,
  Settings,
  UserCheck,
  Sliders,
} from 'lucide-react';
import { Badge, Button, Card } from '@/components/ui';
import { cn } from '@/lib/utils';
import { listRoles } from '@/api/roles';
import {
  listPlugins,
  switchPlugin,
  type DSHPluginsState,
} from '@/api/plugins';
import type { BothousePlugin, ExtendedRoleInfo, RoleEvent, RoleEventType } from './pluginInterface';
import { aggregateRoleStatus, getRoleKey } from './roleAggregation';
import { dshPetPlugin, PET_ADAPTER_ID } from './plugins/dshPetPlugin';
import { getRoleBindings, saveRoleBindings, type RoleBindings, type RolePluginBinding } from '@/api/roleBindings';
import { listInstalledPetPacks, type InstalledPetPack } from '@/api/pets';
import { subscribeRoleEvents, type RoleState } from '@/api/roleEvents';
import api from '@/api/client';

export function deriveRoleStatus(role: ExtendedRoleInfo): RoleEventType {
  if (role.paused || role.online === false) return 'error';
  if (role.status) return role.status;
  if (role.active_sessions && role.active_sessions.length > 0) {
    return aggregateRoleStatus(role.active_sessions, role.busy ? 'working' : 'idle');
  }
  return role.busy ? 'working' : 'idle';
}

function streamRole(state: RoleState, previous?: ExtendedRoleInfo): ExtendedRoleInfo {
  return {
    agent_type: '', model: '', current_task: '', paused: false, platforms: [],
    ...previous, ...state, busy: state.busy_count > 0, sessions_count: state.sessions.length,
    active_sessions: state.sessions.map(session => ({
      sessionId: session.session_key, type: session.status, timestamp: '',
    })),
  };
}

export default function PluginHubPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [roles, setRoles] = useState<ExtendedRoleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [apiError, setApiError] = useState(false);

  // Real DSH Plugins State from /api/v1/plugins
  const [dshPluginsState, setDshPluginsState] = useState<DSHPluginsState | null>(null);
  const [dshPluginsLoading, setDshPluginsLoading] = useState(false);
  const [dshPluginsError, setDshPluginsError] = useState('');
  const [switchingPlugin, setSwitchingPlugin] = useState<string | null>(null);

  const [roleBindings, setRoleBindings] = useState<RoleBindings>({});
  const [bindingsReady, setBindingsReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [bindingsError, setBindingsError] = useState('');
  const [petPacks, setPetPacks] = useState<InstalledPetPack[]>([]);
  const [packsError, setPacksError] = useState('');
  const [streamError, setStreamError] = useState(true);
  const [streamEpoch, setStreamEpoch] = useState(0);
  const hasSnapshot = useRef(false);
  const bindingsDisabled = !bindingsReady || saving || !api.getToken();

  // Built-in Plugins Registry
  const [plugins] = useState<BothousePlugin[]>([dshPetPlugin]);
  const [selectedPluginId, setSelectedPluginId] = useState<string>(
    searchParams.get('plugin') || 'dsh-pet'
  );

  // Unified Role Events Store keyed by roleKey (source:name)
  const [liveEvents, setLiveEvents] = useState<Record<string, RoleEvent>>({});
  const [simEvents, setSimEvents] = useState<Record<string, RoleEvent>>({});
  const events = { ...liveEvents, ...simEvents };

  // Simulator target roleKey
  const [simTargetRoleKey, setSimTargetRoleKey] = useState<string>('bridge:deep');
  const [simulatedRoles, setSimulatedRoles] = useState<Record<string, RoleEventType>>({});

  const fetchDshPlugins = useCallback(async () => {
    setDshPluginsLoading(true);
    try {
      const res = await listPlugins();
      setDshPluginsState(res);
      setDshPluginsError('');
    } catch (err) {
      setDshPluginsError(err instanceof Error ? err.message : '加载已装插件失败');
    } finally {
      setDshPluginsLoading(false);
    }
  }, []);

  const handleTogglePlugin = async (pluginName: string, currentEnabled: boolean) => {
    setSwitchingPlugin(pluginName);
    try {
      const res = await switchPlugin(pluginName, !currentEnabled);
      if (res && res.state) {
        setDshPluginsState(res.state);
      } else {
        await fetchDshPlugins();
      }
    } catch (err) {
      setDshPluginsError(err instanceof Error ? err.message : '切换插件失败');
    } finally {
      setSwitchingPlugin(null);
    }
  };

  const handleRoleBindingChange = async (roleKey: string, pluginId: string, changes: Partial<RolePluginBinding> | null) => {
    if (bindingsDisabled || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    const current = roleBindings[roleKey] || [];
    const existing = current.find(binding => binding.plugin_id === pluginId);
    const updated = current.filter(binding => binding.plugin_id !== pluginId);
    if (changes) updated.push({ plugin_id: pluginId, enabled: false, ...existing, ...changes });
    const next = { ...roleBindings };
    if (updated.length) next[roleKey] = updated;
    else delete next[roleKey];
    try {
      const saved = await saveRoleBindings(next);
      setRoleBindings(saved.bindings);
      setBindingsError('');
    } catch (err) {
      setBindingsError(err instanceof Error ? err.message : '角色配置保存失败');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const fetchSettings = useCallback(async () => {
    const results = await Promise.allSettled([getRoleBindings(), listInstalledPetPacks()]);
    const [bindings, packs] = results;
    if (bindings.status === 'fulfilled') {
      setRoleBindings(bindings.value.bindings);
      setBindingsReady(true);
      setBindingsError('');
    } else {
      setBindingsReady(false);
      setBindingsError('角色绑定读取失败：' + String(bindings.reason));
    }
    if (packs.status === 'fulfilled') {
      setPetPacks(packs.value.installed);
      setPacksError('');
    } else {
      setPetPacks([]);
      setPacksError('本机形象包读取失败：' + String(packs.reason));
    }
  }, []);

  const fetchRoles = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const res = await listRoles();
      if (res && Array.isArray(res.roles) && res.roles.length > 0) {
        const merged = res.roles.map((r) => {
          const ext = r as ExtendedRoleInfo;
          return {
            ...r,
            source: ext.source || 'bridge',
            active_sessions: ext.active_sessions || [],
          };
        });
        if (!hasSnapshot.current) setRoles(merged);
        setApiError(false);
      } else {
        setRoles((prev) => (prev.length > 0 ? prev : []));
        setApiError(true);
      }
    } catch {
      setRoles((prev) => (prev.length > 0 ? prev : []));
      setApiError(true);
    } finally {
      setLoading(false);
      if (isManual) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchRoles();
    fetchDshPlugins();
    fetchSettings();
  }, [fetchRoles, fetchDshPlugins, fetchSettings]);

  useEffect(() => {
    const roleEvent = (state: RoleState, time: string): RoleEvent => ({
      roleKey: state.role_key, roleName: state.name, source: state.source,
      roleDisplayName: state.display_name, type: state.status, timestamp: time,
    });
    return subscribeRoleEvents({
      snapshot(snapshot) {
        hasSnapshot.current = true;
        setStreamError(false);
        setApiError(false);
        setLoading(false);
        // 断线重连快照替换整个集合，清掉旧角色、旧会话和旧气泡。
        const states = snapshot.roles.map(state => state.source === 'dsh' && snapshot.dsh.status !== 'running'
          ? { ...state, online: false, status: 'error' as const, busy_count: 0, sessions: [] } : state);
        setRoles(previous => states.map(state => streamRole(state, previous.find(role => getRoleKey(role) === state.role_key))));
        setLiveEvents(Object.fromEntries(states.map(state => [state.role_key, roleEvent(state, snapshot.time)])));
        setSimEvents(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => states.some(state => state.role_key === key))));
        setSimulatedRoles(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => states.some(state => state.role_key === key))));
      },
      event(event) {
        setStreamError(false);
        setRoles(previous => {
          const old = previous.find(role => getRoleKey(role) === event.role_key);
          const updated = streamRole(event.role, old);
          return old ? previous.map(role => getRoleKey(role) === event.role_key ? updated : role) : [...previous, updated];
        });
        setLiveEvents(previous => ({ ...previous, [event.role_key]: {
          ...roleEvent(event.role, event.time), sessionId: event.session_key,
          speechText: event.type === 'speech' ? event.text : previous[event.role_key]?.speechText,
        } }));
      },
      error() { setStreamError(true); },
    });
  }, [streamEpoch]);


  // Synchronize target role key when roles change
  useEffect(() => {
    if (roles.length > 0 && simTargetRoleKey !== 'all') {
      const keys = roles.map((r) => getRoleKey(r));
      if (!keys.includes(simTargetRoleKey)) {
        setSimTargetRoleKey(keys[0]);
      }
    }
  }, [roles, simTargetRoleKey]);

  const handleEmitEvent = (type: RoleEventType) => {
    const now = new Date().toISOString();

    if (simTargetRoleKey === 'all') {
      const updatedEvents: Record<string, RoleEvent> = {};
      const nextSimMap: Record<string, RoleEventType> = {};

      roles.forEach((r) => {
        const k = getRoleKey(r);
        let speechText: string | undefined;
        if (type === 'speech') {
          speechText = `${r.display_name || r.name}：统一插件事件联动正常！`;
        }
        updatedEvents[k] = {
          roleKey: k,
          roleName: r.name,
          source: r.source || 'bridge',
          roleDisplayName: r.display_name,
          type,
          timestamp: now,
          task: r.current_task,
          speechText,
        };
        nextSimMap[k] = type;
      });

      setSimEvents((prev) => ({ ...prev, ...updatedEvents }));
      setSimulatedRoles((prev) => ({ ...prev, ...nextSimMap }));
    } else {
      const targetRole = roles.find((r) => getRoleKey(r) === simTargetRoleKey) || roles[0];
      if (!targetRole) return;

      const k = getRoleKey(targetRole);
      let speechText: string | undefined;
      if (type === 'speech') {
        speechText = `${targetRole.display_name || targetRole.name}：统一插件事件联动正常！`;
      }

      setSimEvents((prev) => ({
        ...prev,
        [k]: {
          roleKey: k,
          roleName: targetRole.name,
          source: targetRole.source || 'bridge',
          roleDisplayName: targetRole.display_name,
          type,
          timestamp: now,
          task: targetRole.current_task,
          speechText,
        },
      }));
      setSimulatedRoles((prev) => ({
        ...prev,
        [k]: type,
      }));
    }
  };

  const handleResetLive = () => {
    if (simTargetRoleKey === 'all') {
      setSimEvents({});
      setSimulatedRoles({});
    } else {
      setSimEvents(previous => { const next = { ...previous }; delete next[simTargetRoleKey]; return next; });
      setSimulatedRoles(previous => { const next = { ...previous }; delete next[simTargetRoleKey]; return next; });
    }
  };

  const isTargetSimulated =
    simTargetRoleKey === 'all'
      ? Object.keys(simulatedRoles).length > 0
      : Boolean(simulatedRoles[simTargetRoleKey]);

  const activePlugin = plugins.find((p) => p.id === selectedPluginId) || plugins[0];

  return (
    <div className="space-y-6 animate-fade-in" data-testid="plugin-hub-page">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-hairline pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink flex items-center gap-2">
            <Boxes className="text-accent" size={24} />
            <span>插件总页与生态接口</span>
          </h1>
          <p className="mt-1 text-xs text-ink-soft">
            统一插件接口规范：接真实 DSH 插件列表、插件按角色配（每个角色配一份）、统一角色事件驱动桌宠
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/plugins/dsh"
            className="inline-flex items-center gap-1.5 rounded-control border border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-sunken transition-colors"
          >
            <Settings size={14} />
            <span>DSH 原生配置管理</span>
          </Link>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              fetchRoles(true);
              fetchDshPlugins();
              fetchSettings();
              setStreamEpoch(epoch => epoch + 1);
            }}
            disabled={refreshing || loading || saving}
            data-testid="refresh-roles-btn"
          >
            <RotateCw size={14} className={refreshing ? 'animate-spin' : ''} />
            <span>刷新数据</span>
          </Button>
        </div>
      </div>

      {(apiError || streamError) && <div role="status" data-testid="roles-api-error-alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
        {streamError ? '角色事件连接中或已断开，正在重连；当前显示最后已知状态。' : '角色列表读取失败。'}
      </div>}
      {bindingsError && <div role="alert" className="text-sm text-red-600">{bindingsError}</div>}
      {packsError && <div role="alert" className="text-sm text-amber-700">{packsError}</div>}
      {!api.getToken() && <p className="text-xs text-ink-mute">当前为只读查看，登录后可保存角色配置。</p>}

      {/* 1. Real DSH Plugins Section (from /api/v1/plugins) */}
      <div className="space-y-3" data-testid="dsh-real-plugins-section">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-ink flex items-center gap-2">
            <Package size={18} className="text-accent" />
            <span>已接入插件列表</span>
          </h2>
          <span className="text-xs text-ink-soft">
            {dshPluginsState?.plugins
              ? `本机 DSH Profile 实际安装 ${dshPluginsState.plugins.length} 个插件`
              : '正在从 DSH Profile 检索已安装插件…'}
          </span>
        </div>

        {dshPluginsLoading && !dshPluginsState && (
          <div className="rounded-xl border border-hairline bg-surface p-6 text-center text-xs text-ink-mute">
            正在读取本机 DSH 插件列表…
          </div>
        )}

        {dshPluginsError && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700">
            DSH 插件接口状态：{dshPluginsError}
          </div>
        )}

        {/* Real DSH Plugins Grid */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {/* Always display dsh-pet as the leading integrated plugin card */}
          <div
            className="cursor-pointer"
            onClick={() => {
              setSelectedPluginId('dsh-pet');
              setSearchParams({ plugin: 'dsh-pet' });
            }}
            data-testid="plugin-card-dsh-pet"
          >
            <Card
              className={cn(
                'flex flex-col justify-between border p-4 transition-all duration-200 h-full',
                selectedPluginId === 'dsh-pet'
                  ? 'ring-2 ring-accent border-accent/60 bg-accent-wash/10'
                  : 'bg-surface hover:border-hairline-strong'
              )}
            >
              <div>
                <div className="flex items-start justify-between gap-2 border-b border-hairline pb-2.5">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-ink text-sm">桌宠角色与形象包适配</span>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px]">面板适配器</Badge>
                </div>
                <p className="mt-2.5 text-xs text-ink-soft leading-relaxed line-clamp-2">
                  为 bothouse 角色注入桌宠动画。按角色事件（空闲、工作中、思考、交活庆祝、出错）切动作并冒气泡。
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {['idle', 'working', 'thinking', 'celebrate', 'error', 'speech'].map((ev) => (
                    <span key={ev} className="rounded bg-surface-sunken px-1.5 py-0.5 text-[9px] font-mono text-ink-soft">
                      {ev}
                    </span>
                  ))}
                </div>
              </div>
              <div className="mt-3 flex items-center justify-end border-t border-hairline pt-2.5">
                <Button
                  variant={selectedPluginId === 'dsh-pet' ? 'primary' : 'secondary'}
                  size="sm"
                  className="text-xs h-7"
                >
                  {selectedPluginId === 'dsh-pet' ? '✓ 当前专区' : '进入专区'}
                </Button>
              </div>
            </Card>
          </div>

          {/* Real DSH Plugins from profile */}
          {dshPluginsState?.plugins?.map((plugin) => (
            <Card
              key={plugin.name}
              className="flex flex-col justify-between border p-4 bg-surface hover:border-hairline-strong transition-all duration-200"
              data-testid={`dsh-plugin-card-${plugin.name}`}
            >
              <div>
                <div className="flex items-start justify-between gap-2 border-b border-hairline pb-2.5">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-ink text-sm truncate max-w-[160px]" title={plugin.name}>
                        {plugin.name}
                      </span>
                      {plugin.version && (
                        <Badge variant="outline" className="text-[10px] font-mono">{plugin.version}</Badge>
                      )}
                    </div>
                    <span className="mt-0.5 block text-[10px] text-ink-mute font-mono">
                      {plugin.source || (plugin.shipped ? 'DSH 内置' : 'npm registry')}
                    </span>
                  </div>
                  <Badge variant={plugin.enabled ? 'success' : 'outline'} className="text-[10px]">
                    {plugin.enabled ? '已启用' : '已停用'}
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-ink-soft leading-relaxed line-clamp-2">
                  {plugin.description || 'DSH 官方或社区扩展插件。'}
                </p>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-hairline pt-2.5">
                <span className="text-[10px] text-ink-mute">
                  {plugin.layer ? 'Bundle Layer' : 'Surface Layer'}
                </span>
                {!plugin.shipped && (
                  <Button
                    variant={plugin.enabled ? 'ghost' : 'secondary'}
                    size="sm"
                    className="text-xs h-7"
                    disabled={switchingPlugin === plugin.name || !plugin.layer || !dshPluginsState.writes_allowed}
                    onClick={() => handleTogglePlugin(plugin.name, plugin.enabled)}
                  >
                    {switchingPlugin === plugin.name ? '切换中…' : plugin.enabled ? '停用' : '启用'}
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* 2. Plugin Configuration Per Role (每个角色配一份) */}
      <div className="space-y-3" data-testid="role-plugin-config-section">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-ink flex items-center gap-2">
              <UserCheck size={18} className="text-accent" />
              <span>插件按角色配置 (每个角色配一份)</span>
            </h2>
            <p className="text-xs text-ink-soft mt-0.5">
              每个角色配一份插件与形象包；解绑即时生效并持久保存，刷新不丢失，解绑真解绑不回退默认。
            </p>
          </div>
          <span className="text-xs text-ink-mute font-mono">共 {roles.length} 个角色</span>
        </div>

        <Card className="overflow-hidden border p-0 bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs" data-testid="role-config-table">
              <thead className="border-b border-hairline bg-surface-sunken/50 text-[11px] font-semibold text-ink-soft">
                <tr>
                  <th className="py-2.5 px-4">角色标识</th>
                  <th className="py-2.5 px-3">当前状态</th>
                  <th className="py-2.5 px-3">桌宠插件联动</th>
                  <th className="py-2.5 px-4">绑定动作形象包</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {roles.map((r) => {
                  const k = getRoleKey(r);
                  const bindings = roleBindings[k] || [];
                  const cfg = bindings.find(binding => binding.plugin_id === PET_ADAPTER_ID);
                  const currentStatus = deriveRoleStatus(r);

                  return (
                    <tr key={k} className="hover:bg-surface-sunken/30 transition-colors" data-testid={`role-config-row-${k}`}>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-ink text-sm">{r.display_name || r.name}</span>
                          <span className="text-[10px] font-mono text-ink-mute">({k})</span>
                        </div>
                        <span className="text-[10px] text-ink-soft font-mono">{r.model || 'model'}</span>
                      </td>

                      <td className="py-3 px-3">
                        <Badge
                          variant={
                            currentStatus === 'working'
                              ? 'info'
                              : currentStatus === 'celebrate'
                              ? 'success'
                              : currentStatus === 'error'
                              ? 'danger'
                              : 'default'
                          }
                          className="text-[10px]"
                        >
                          {currentStatus === 'working'
                            ? '干活中'
                            : currentStatus === 'celebrate'
                            ? '交活庆祝'
                            : currentStatus === 'error'
                            ? '出错/离线'
                            : '待机中'}
                        </Badge>
                      </td>

                      <td className="py-3 px-3">
                        {[{ name: PET_ADAPTER_ID, label: '桌宠适配器' }, ...(dshPluginsState?.plugins || []).map(plugin => ({ name: plugin.name, label: plugin.name }))].map(plugin => {
                          const binding = bindings.find(item => item.plugin_id === plugin.name);
                          return <label key={plugin.name} className="mr-3 inline-flex items-center gap-1.5">
                            <input type="checkbox" checked={binding?.enabled || false} disabled={bindingsDisabled}
                              data-testid={`checkbox-plugin-${k}-${plugin.name}`}
                              onChange={event => handleRoleBindingChange(k, plugin.name, { enabled: event.target.checked })} />
                            <span>{plugin.label}</span>
                          </label>;
                        })}
                      </td>
                      <td className="py-3 px-4">
                        <select value={cfg?.avatar_pack || ''} disabled={bindingsDisabled}
                          data-testid={`select-pack-${k}`}
                          onChange={event => handleRoleBindingChange(k, PET_ADAPTER_ID, event.target.value ? { enabled: true, avatar_pack: event.target.value } : null)}
                          className="h-8 rounded-md border border-hairline bg-surface px-2.5 text-xs text-ink disabled:opacity-50">
                          <option value="">形象待接入 (未绑定)</option>
                          {cfg?.avatar_pack && !petPacks.some(pack => pack.id === cfg.avatar_pack) && <option value={cfg.avatar_pack}>未安装：{cfg.avatar_pack}</option>}
                          {petPacks.map(pack => <option key={pack.id} value={pack.id} disabled={!!pack.error}>{pack.name} [{pack.error ? '包异常' : '本地已装'}]</option>)}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* 3. Unified Simulator Section */}
      <Card className="bg-surface p-4 shadow-sm ring-1 ring-hairline" data-testid="unified-simulator">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          {/* Target Role Selector */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-ink flex items-center gap-1">
              <Sliders size={14} className="text-accent" />
              <span>事件模拟目标角色：</span>
            </span>

            <select
              data-testid="sim-target-select"
              value={simTargetRoleKey}
              onChange={(e) => setSimTargetRoleKey(e.target.value)}
              className="h-8 rounded-md border border-hairline bg-surface-sunken px-2.5 text-xs font-medium text-ink focus:border-accent focus:outline-none"
            >
              <option value="all">📢 全部角色 (逐个广播，不串台)</option>
              {roles.map((r) => {
                const k = getRoleKey(r);
                return (
                  <option key={k} value={k}>
                    {r.display_name || r.name} ({k})
                  </option>
                );
              })}
            </select>

            {isTargetSimulated ? (
              <Badge variant="warning" className="text-xs" data-testid="sim-broadcasting-badge">
                {simTargetRoleKey === 'all'
                  ? '广播模拟中'
                  : `正在模拟：${simulatedRoles[simTargetRoleKey]}`}
              </Badge>
            ) : (
              <Badge variant="success" className="text-xs">
                {streamError ? '事件流重连中' : '实时总线监听'}
              </Badge>
            )}
          </div>

          {/* Unified Simulator Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              data-testid="sim-btn-idle"
              onClick={() => handleEmitEvent('idle')}
              className="flex items-center gap-1 text-xs"
            >
              <Coffee size={13} />
              <span>待机呼吸</span>
            </Button>

            <Button
              variant="secondary"
              size="sm"
              data-testid="sim-btn-working"
              onClick={() => handleEmitEvent('working')}
              className="flex items-center gap-1 text-xs"
            >
              <Flame size={13} className="text-amber-500" />
              <span>干活中</span>
            </Button>

            <Button
              variant="secondary"
              size="sm"
              data-testid="sim-btn-thinking"
              onClick={() => handleEmitEvent('thinking')}
              className="flex items-center gap-1 text-xs"
            >
              <HelpCircle size={13} className="text-blue-500" />
              <span>思考中</span>
            </Button>

            <Button
              variant="secondary"
              size="sm"
              data-testid="sim-btn-celebrate"
              onClick={() => handleEmitEvent('celebrate')}
              className="flex items-center gap-1 text-xs"
            >
              <PartyPopper size={13} className="text-emerald-500" />
              <span>交活庆祝</span>
            </Button>

            <Button
              variant="secondary"
              size="sm"
              data-testid="sim-btn-error"
              onClick={() => handleEmitEvent('error')}
              className="flex items-center gap-1 text-xs"
            >
              <AlertTriangle size={13} className="text-red-500" />
              <span>出错/疲惫</span>
            </Button>

            <Button
              variant="secondary"
              size="sm"
              data-testid="sim-btn-speech"
              onClick={() => handleEmitEvent('speech')}
              className="flex items-center gap-1 text-xs"
            >
              <MessageSquare size={13} />
              <span>说了一句</span>
            </Button>

            {isTargetSimulated && (
              <Button
                variant="ghost"
                size="sm"
                data-testid="sim-btn-reset"
                onClick={handleResetLive}
                className="text-xs text-ink-soft hover:text-ink"
              >
                {simTargetRoleKey === 'all' ? '恢复全部实时事件' : '恢复该角色实时'}
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* 4. Selected Plugin Viewport: 桌宠专区 */}
      <div className="rounded-2xl border border-hairline bg-surface p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between border-b border-hairline pb-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold uppercase tracking-wider text-accent">
              插件专区视图：
            </span>
            <h2 className="text-lg font-bold text-ink">{activePlugin.name}</h2>
          </div>
        </div>

        {/* Plugin Render execution */}
        {(() => {
          const ActivePluginView = activePlugin.render;
          return (
            <ActivePluginView
              events={events}
              roles={roles}
              isSimulated={Object.keys(simulatedRoles).length > 0}
              roleBindings={roleBindings}
              petPacks={petPacks}
              bindingsDisabled={bindingsDisabled}
              onRoleBindingChange={handleRoleBindingChange}
            />
          );
        })()}
      </div>
    </div>
  );
}
