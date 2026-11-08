import { useCallback, useEffect, useState } from 'react';
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
  Layers,
  Settings,
  Sparkles,
  UserCheck,
  CheckCircle2,
  ExternalLink,
  Sliders,
} from 'lucide-react';
import { Badge, Button, Card } from '@/components/ui';
import { cn } from '@/lib/utils';
import { listRoles } from '@/api/roles';
import {
  listPlugins,
  switchPlugin,
  type DSHPlugin,
  type DSHPluginsState,
} from '@/api/plugins';
import type { BothousePlugin, ExtendedRoleInfo, RoleEvent, RoleEventType } from './pluginInterface';
import { aggregateRoleStatus, getRoleKey } from './roleAggregation';
import { dshPetPlugin } from './plugins/dshPetPlugin';

export function deriveRoleStatus(role: ExtendedRoleInfo): RoleEventType {
  if (role.paused || role.online === false) return 'error';
  if (role.active_sessions && role.active_sessions.length > 0) {
    return aggregateRoleStatus(role.active_sessions, role.busy ? 'working' : 'idle');
  }
  return role.busy ? 'working' : 'idle';
}

export const DEFAULT_DEMO_ROLES: ExtendedRoleInfo[] = [
  {
    name: 'deep',
    display_name: '肥鱼',
    agent_type: 'deepseek',
    model: 'deepseek-v4.1-flash',
    online: true,
    busy: false,
    current_task: '',
    paused: false,
    platforms: [{ name: 'qq', ready: true }, { name: 'discord', ready: true }],
    sessions_count: 0,
    source: 'bridge',
    active_sessions: [],
  },
  {
    name: 'gjiang',
    display_name: '大豆包',
    agent_type: 'frontend',
    model: 'gemini-3.8-flash',
    online: true,
    busy: false,
    current_task: '',
    paused: false,
    platforms: [{ name: 'discord', ready: true }],
    sessions_count: 0,
    source: 'bridge',
    active_sessions: [],
  },
  {
    name: 'gge',
    display_name: 'G哥',
    agent_type: 'architect',
    model: 'xiao/gpt-6-astra',
    online: true,
    busy: false,
    current_task: '',
    paused: false,
    platforms: [{ name: 'discord', ready: true }],
    sessions_count: 0,
    source: 'bridge',
    active_sessions: [],
  },
  {
    name: 'cjiang',
    display_name: 'C酱',
    agent_type: 'reviewer',
    model: 'claude-opus-5-5',
    online: true,
    busy: false,
    current_task: '',
    paused: false,
    platforms: [{ name: 'discord', ready: true }],
    sessions_count: 0,
    source: 'bridge',
    active_sessions: [],
  },
  {
    name: 'mika',
    display_name: '橘',
    agent_type: 'lead',
    model: 'claude-3-7-sonnet',
    online: true,
    busy: false,
    current_task: '',
    paused: false,
    platforms: [{ name: 'discord', ready: true }],
    sessions_count: 0,
    source: 'bridge',
    active_sessions: [],
  },
];

export const AVAILABLE_PET_PACK_OPTIONS = [
  { id: '', name: '形象待接入 (未绑定)' },
  { id: 'dsh1', name: '肥鱼 (dsh1 新动作包)' },
  { id: 'claude', name: 'C酱 (claude 动作包)' },
  { id: 'gpt1', name: 'GPT (gpt1 动作包)' },
  { id: 'gemini', name: 'Gemini (gemini 动作包)' },
  { id: 'dsh-official', name: '官方透明 WebM 包' },
];

export interface RolePluginConfig {
  petEnabled: boolean;
  petPackId: string | null;
}

const STORAGE_KEY_ROLE_CONFIGS = 'bothouse_role_plugin_bindings_v5';
const STORAGE_KEY_PET_BINDINGS = 'bothouse_pet_bindings_v4';

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

  // Role-based plugin configurations (per role, saved in localStorage)
  const [roleConfigs, setRoleConfigs] = useState<Record<string, RolePluginConfig>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_ROLE_CONFIGS);
      if (saved) return JSON.parse(saved);
    } catch {
      // Fallback
    }
    return {
      'bridge:deep': { petEnabled: true, petPackId: 'dsh1' },
      deep: { petEnabled: true, petPackId: 'dsh1' },
      'bridge:cjiang': { petEnabled: true, petPackId: 'claude' },
      cjiang: { petEnabled: true, petPackId: 'claude' },
    };
  });

  // Built-in Plugins Registry
  const [plugins] = useState<BothousePlugin[]>([dshPetPlugin]);
  const [selectedPluginId, setSelectedPluginId] = useState<string>(
    searchParams.get('plugin') || 'dsh-pet'
  );

  // Unified Role Events Store keyed by roleKey (source:name)
  const [events, setEvents] = useState<Record<string, RoleEvent>>({});

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
      console.error('Failed to toggle plugin', err);
    } finally {
      setSwitchingPlugin(null);
    }
  };

  const handleRoleConfigChange = (
    roleKey: string,
    changes: Partial<RolePluginConfig>
  ) => {
    setRoleConfigs((prev) => {
      const current = prev[roleKey] || { petEnabled: true, petPackId: null };
      const updated = { ...current, ...changes };
      const next = { ...prev, [roleKey]: updated };
      try {
        localStorage.setItem(STORAGE_KEY_ROLE_CONFIGS, JSON.stringify(next));
        const petBindings: Record<string, string | null> = {};
        Object.entries(next).forEach(([k, v]) => {
          petBindings[k] = v.petEnabled ? v.petPackId : null;
        });
        localStorage.setItem(STORAGE_KEY_PET_BINDINGS, JSON.stringify(petBindings));
      } catch {
        // Storage write error ignored
      }
      return next;
    });
  };

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
        setRoles(merged);
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
    const timer = setInterval(() => fetchRoles(), 4000);
    return () => clearInterval(timer);
  }, [fetchRoles, fetchDshPlugins]);

  // Synchronize target role key when roles change
  useEffect(() => {
    if (roles.length > 0 && simTargetRoleKey !== 'all') {
      const keys = roles.map((r) => getRoleKey(r));
      if (!keys.includes(simTargetRoleKey)) {
        setSimTargetRoleKey(keys[0]);
      }
    }
  }, [roles, simTargetRoleKey]);

  // Update default events from live roles when not simulated
  useEffect(() => {
    setEvents((prevEvents) => {
      const nextEvents: Record<string, RoleEvent> = { ...prevEvents };
      const now = new Date().toISOString();

      roles.forEach((r) => {
        const k = getRoleKey(r);
        if (simulatedRoles[k]) return;

        const type = deriveRoleStatus(r);

        nextEvents[k] = {
          roleKey: k,
          roleName: r.name,
          source: r.source || 'bridge',
          roleDisplayName: r.display_name,
          type,
          timestamp: now,
          task: r.current_task,
        };
      });

      return nextEvents;
    });
  }, [roles, simulatedRoles]);

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

      setEvents((prev) => ({ ...prev, ...updatedEvents }));
      setSimulatedRoles((prev) => ({ ...prev, ...nextSimMap }));
    } else {
      const targetRole = roles.find((r) => getRoleKey(r) === simTargetRoleKey) || roles[0];
      if (!targetRole) return;

      const k = getRoleKey(targetRole);
      let speechText: string | undefined;
      if (type === 'speech') {
        speechText = `${targetRole.display_name || targetRole.name}：统一插件事件联动正常！`;
      }

      setEvents((prev) => ({
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
    const now = new Date().toISOString();

    if (simTargetRoleKey === 'all') {
      const resetEvents: Record<string, RoleEvent> = {};
      roles.forEach((r) => {
        const k = getRoleKey(r);
        resetEvents[k] = {
          roleKey: k,
          roleName: r.name,
          source: r.source || 'bridge',
          roleDisplayName: r.display_name,
          type: deriveRoleStatus(r),
          timestamp: now,
          task: r.current_task,
        };
      });
      setEvents(resetEvents);
      setSimulatedRoles({});
    } else {
      const targetRole = roles.find((r) => getRoleKey(r) === simTargetRoleKey) || roles[0];
      if (!targetRole) return;
      const k = getRoleKey(targetRole);

      setEvents((prev) => ({
        ...prev,
        [k]: {
          roleKey: k,
          roleName: targetRole.name,
          source: targetRole.source || 'bridge',
          roleDisplayName: targetRole.display_name,
          type: deriveRoleStatus(targetRole),
          timestamp: now,
          task: targetRole.current_task,
        },
      }));
      setSimulatedRoles((prev) => {
        const next = { ...prev };
        delete next[k];
        return next;
      });
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
            }}
            disabled={refreshing || loading}
            data-testid="refresh-roles-btn"
          >
            <RotateCw size={14} className={refreshing ? 'animate-spin' : ''} />
            <span>刷新数据</span>
          </Button>
        </div>
      </div>

      {/* API connection warning if roles failed to load */}
      {apiError && roles.length === 0 && (
        <div data-testid="roles-api-error-alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-xs text-red-600 flex items-center justify-between">
          <span>后台角色接口连接失败或返回空数据</span>
          <button
            type="button"
            data-testid="load-demo-roles-btn"
            onClick={() => {
              setRoles(DEFAULT_DEMO_ROLES);
              setApiError(false);
            }}
            className="rounded bg-red-600 px-2.5 py-1 text-white hover:bg-red-700 font-medium"
          >
            加载空闲演示角色 (用于本地开发调试)
          </button>
        </div>
      )}

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
            DSH 插件接口状态：{dshPluginsError} (使用默认生态声明)
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
                      <Badge variant="outline" className="text-[10px] font-mono">v0.1.0</Badge>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-ink-soft">
                      <span>PC2005-cloud & hunmer</span>
                      <span>•</span>
                      <span className="text-accent">遵循各形象包自带说明</span>
                    </div>
                  </div>
                  <Badge variant="success" className="text-[10px]">运行中</Badge>
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
              <div className="mt-3 flex items-center justify-between border-t border-hairline pt-2.5">
                <span className="text-[10px] text-ink-mute">MIT 适配层</span>
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
                    disabled={switchingPlugin === plugin.name}
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
          <span className="text-xs text-ink-mute font-mono">共 {roles.length} 个角色在线</span>
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
                  const cfg = roleConfigs[k] || roleConfigs[r.name] || {
                    petEnabled: true,
                    petPackId: r.name === 'deep' ? 'dsh1' : r.name === 'cjiang' ? 'claude' : null,
                  };
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
                        <label className="inline-flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={cfg.petEnabled}
                            onChange={(e) => handleRoleConfigChange(k, { petEnabled: e.target.checked })}
                            className="rounded border-hairline text-accent focus:ring-accent"
                            data-testid={`checkbox-pet-${k}`}
                          />
                          <span className="text-xs text-ink">{cfg.petEnabled ? '已启用桌宠' : '未启用'}</span>
                        </label>
                      </td>

                      <td className="py-3 px-4">
                        <select
                          value={cfg.petPackId || ''}
                          disabled={!cfg.petEnabled}
                          onChange={(e) => {
                            const val = e.target.value;
                            handleRoleConfigChange(k, { petPackId: val === '' ? null : val });
                          }}
                          data-testid={`select-pack-${k}`}
                          className="h-8 rounded-md border border-hairline bg-surface px-2.5 text-xs text-ink shadow-xs focus:border-accent focus:outline-none disabled:opacity-50"
                        >
                          {AVAILABLE_PET_PACK_OPTIONS.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.name}
                            </option>
                          ))}
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
                实时总线监听
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
          <span className="text-xs text-ink-mute">
            {activePlugin.author} ({activePlugin.license})
          </span>
        </div>

        {/* Plugin Render execution */}
        {(() => {
          const ActivePluginView = activePlugin.render;
          return (
            <ActivePluginView
              events={events}
              roles={roles}
              isSimulated={Object.keys(simulatedRoles).length > 0}
            />
          );
        })()}
      </div>
    </div>
  );
}
