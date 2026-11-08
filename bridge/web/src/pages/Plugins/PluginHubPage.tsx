import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Boxes,
  RotateCw,
  ExternalLink,
  Coffee,
  Flame,
  HelpCircle,
  PartyPopper,
  AlertTriangle,
  MessageSquare,
  Sliders,
  Code2,
  Target,
} from 'lucide-react';
import { Badge, Button, Card } from '@/components/ui';
import { cn } from '@/lib/utils';
import { listRoles } from '@/api/roles';
import type { BothousePlugin, ExtendedRoleInfo, RoleEvent, RoleEventType } from './pluginInterface';
import { aggregateRoleStatus, getRoleKey } from './roleAggregation';
import { dshPetPlugin } from './plugins/dshPetPlugin';
import { personalityPlugin } from './plugins/personalityPlugin';

const DEFAULT_DEMO_ROLES: ExtendedRoleInfo[] = [
  {
    name: 'deep',
    display_name: '肥鱼',
    agent_type: 'deepseek',
    model: 'deepseek-v4.1-flash',
    online: true,
    busy: true,
    current_task: '工作区1：协助审核代码',
    paused: false,
    platforms: [{ name: 'qq', ready: true }, { name: 'discord', ready: true }],
    sessions_count: 2,
    source: 'bridge',
    active_sessions: [
      { sessionId: 'sess-ws1', type: 'working', task: '工作区1：协助审核代码', timestamp: '2026-11-08T23:00:00Z' },
      { sessionId: 'sess-ws2', type: 'thinking', task: '工作区2：跑定向单元测试', timestamp: '2026-11-08T23:01:00Z' },
    ],
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

export default function PluginHubPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [roles, setRoles] = useState<ExtendedRoleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Plugin Registry
  const [plugins, setPlugins] = useState<BothousePlugin[]>([dshPetPlugin, personalityPlugin]);
  // Selected plugin id whose area is rendered below
  const [selectedPluginId, setSelectedPluginId] = useState<string>(
    searchParams.get('plugin') || 'dsh-pet'
  );

  // Unified Role Events Store keyed by roleKey (source:name)
  const [events, setEvents] = useState<Record<string, RoleEvent>>({});

  // Simulator target roleKey: defaults to first role (e.g. bridge:deep), or 'all' for broadcast demo
  const [simTargetRoleKey, setSimTargetRoleKey] = useState<string>('bridge:deep');
  // Track which roleKeys have active simulation
  const [simulatedRoles, setSimulatedRoles] = useState<Record<string, RoleEventType>>({});

  const fetchRoles = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const res = await listRoles();
      if (res && Array.isArray(res.roles) && res.roles.length > 0) {
        // Strictly preserve API source and never overwrite with demo data!
        // Never inject mock active_sessions into live roles.
        const merged = res.roles.map((r) => {
          const ext = r as ExtendedRoleInfo;
          return {
            ...r,
            source: ext.source || 'bridge',
            active_sessions: ext.active_sessions || [],
          };
        });
        setRoles(merged);
      } else {
        setRoles(DEFAULT_DEMO_ROLES);
      }
    } catch {
      setRoles(DEFAULT_DEMO_ROLES);
    } finally {
      setLoading(false);
      if (isManual) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchRoles();
    const timer = setInterval(() => fetchRoles(), 4000);
    return () => clearInterval(timer);
  }, [fetchRoles]);

  // Update default events from live roles when not simulated
  useEffect(() => {
    setEvents((prevEvents) => {
      const nextEvents: Record<string, RoleEvent> = { ...prevEvents };
      const now = new Date().toISOString();

      roles.forEach((r) => {
        const k = getRoleKey(r);
        // If this roleKey is currently being simulated, keep the simulated event
        if (simulatedRoles[k]) return;

        let type: RoleEventType = 'idle';
        if (r.paused || !r.online) type = 'error';
        else if (r.active_sessions && r.active_sessions.length > 0) {
          type = aggregateRoleStatus(r.active_sessions, r.busy ? 'working' : 'idle');
        } else if (r.busy) {
          type = 'working';
        }

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

  // Emit unified event to the chosen target roleKey or broadcast to all
  const handleEmitEvent = (type: RoleEventType) => {
    const now = new Date().toISOString();

    if (simTargetRoleKey === 'all') {
      // Broadcast to each role with its unique roleKey
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
          task: type === 'working' ? (r.current_task || '模拟推进重要特性开发') : undefined,
          speechText,
        };
        nextSimMap[k] = type;
      });

      setEvents((prev) => ({ ...prev, ...updatedEvents }));
      setSimulatedRoles(nextSimMap);
    } else {
      // Emit ONLY to the selected roleKey; all other roles stay unchanged!
      const targetRole = roles.find((r) => getRoleKey(r) === simTargetRoleKey) || roles[0];
      if (!targetRole) return;
      const k = simTargetRoleKey;

      let speechText: string | undefined;
      if (type === 'speech') {
        speechText = `${targetRole.display_name || targetRole.name}：收到角色专属事件！`;
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
          task: type === 'working' ? (targetRole.current_task || '模拟单角色推进特性开发') : undefined,
          speechText,
        },
      }));
      setSimulatedRoles((prev) => ({ ...prev, [k]: type }));
    }
  };

  const handleResetLive = () => {
    const now = new Date().toISOString();

    if (simTargetRoleKey === 'all') {
      // Reset all roles
      const resetEvents: Record<string, RoleEvent> = {};
      roles.forEach((r) => {
        const k = getRoleKey(r);
        let type: RoleEventType = 'idle';
        if (r.paused || !r.online) type = 'error';
        else if (r.active_sessions && r.active_sessions.length > 0) {
          type = aggregateRoleStatus(r.active_sessions, r.busy ? 'working' : 'idle');
        } else if (r.busy) {
          type = 'working';
        }
        resetEvents[k] = {
          roleKey: k,
          roleName: r.name,
          source: r.source || 'bridge',
          roleDisplayName: r.display_name,
          type,
          timestamp: now,
          task: r.current_task,
        };
      });
      setEvents(resetEvents);
      setSimulatedRoles({});
    } else {
      // Reset only the selected target roleKey
      const targetRole = roles.find((r) => getRoleKey(r) === simTargetRoleKey);
      if (!targetRole) return;
      const k = simTargetRoleKey;

      let type: RoleEventType = 'idle';
      if (targetRole.paused || !targetRole.online) type = 'error';
      else if (targetRole.busy) type = 'working';

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
        },
      }));
      setSimulatedRoles((prev) => {
        const next = { ...prev };
        delete next[k];
        return next;
      });
    }
  };

  const activePlugin = plugins.find((p) => p.id === selectedPluginId) || plugins[0];
  const isTargetSimulated = simTargetRoleKey === 'all'
    ? Object.keys(simulatedRoles).length > 0
    : Boolean(simulatedRoles[simTargetRoleKey]);

  return (
    <div className="space-y-6 pb-12" data-testid="plugins-hub-page">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-hairline pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-ink">插件总页与生态接口</h1>
            <Badge variant="info" className="flex items-center gap-1 font-semibold">
              <Code2 size={12} />
              统一插件接口规范
            </Badge>
          </div>
          <p className="mt-1 text-sm text-ink-soft">
            提供标准化插件接口（元数据声明、带 roleKey 的独立角色事件推流），状态严格隔离不互串，多开按优先级聚合。
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/plugins/dsh"
            className="inline-flex items-center gap-1.5 rounded-control border border-hairline bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface-sunken transition-colors"
          >
            <Boxes size={14} />
            <span>DSH 原生配置管理</span>
          </Link>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fetchRoles(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5"
          >
            <RotateCw size={14} className={cn(refreshing && 'animate-spin')} />
            <span>{refreshing ? '刷新中…' : '刷新角色'}</span>
          </Button>
        </div>
      </div>

      {/* Unified Role Event Simulator Bar (Target Selection First to Prevent State Bleeding) */}
      <Card className="bg-surface p-4 shadow-sm ring-1 ring-hairline" data-testid="unified-simulator">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <Sliders size={16} className="text-accent shrink-0" />
            <span className="text-xs font-semibold uppercase tracking-wider text-ink shrink-0">
              事件模拟发射器：
            </span>

            {/* Target Role Selector to ensure state does not bleed */}
            <div className="flex items-center gap-1.5 rounded-md bg-surface-sunken/60 px-2.5 py-1 border border-hairline">
              <Target size={13} className="text-accent shrink-0" />
              <label htmlFor="sim-target-select" className="text-xs font-medium text-ink shrink-0">
                目标角色：
              </label>
              <select
                id="sim-target-select"
                data-testid="sim-target-select"
                value={simTargetRoleKey}
                onChange={(e) => setSimTargetRoleKey(e.target.value)}
                className="h-7 rounded border border-hairline bg-surface px-2 text-xs font-medium text-ink focus:border-accent focus:outline-none"
              >
                {roles.map((r) => {
                  const k = getRoleKey(r);
                  return (
                    <option key={k} value={k}>
                      {r.display_name || r.name} ({k})
                    </option>
                  );
                })}
                <option value="all">【全部角色广播 (仅演示)】</option>
              </select>
            </div>

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

      {/* Plugins Registry Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-ink flex items-center gap-2">
            <Boxes size={18} className="text-accent" />
            已接入插件列表
          </h2>
          <span className="text-xs text-ink-soft">
            共接入 {plugins.length} 个插件规范实现（点击卡片即可切换下方专区）
          </span>
        </div>

        {/* Plugin Cards Grid */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {plugins.map((plugin) => {
            const isSelected = plugin.id === selectedPluginId;

            return (
              <div
                key={plugin.id}
                onClick={() => {
                  setSelectedPluginId(plugin.id);
                  setSearchParams({ plugin: plugin.id });
                }}
                className="cursor-pointer"
              >
                <Card
                  className={cn(
                    'relative flex flex-col justify-between border p-5 transition-all duration-200 h-full',
                    isSelected
                      ? 'ring-2 ring-accent border-accent/60 bg-accent-wash/10'
                      : 'hover:border-hairline-strong bg-surface'
                  )}
                >
                  <div>
                    {/* Plugin Card Header */}
                    <div className="flex items-start justify-between gap-3 border-b border-hairline pb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-base font-bold text-ink">{plugin.name}</span>
                          <Badge variant="outline" className="text-[10px] font-mono">
                            {plugin.version}
                          </Badge>
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-xs text-ink-soft">
                          <span>作者：{plugin.author}</span>
                          <span>•</span>
                          <a
                            href={plugin.repo}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 text-accent underline hover:opacity-80"
                          >
                            来源仓库
                            <ExternalLink size={11} />
                          </a>
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <Badge
                          variant={
                            plugin.status === 'active'
                              ? 'success'
                              : plugin.status === 'pending'
                              ? 'warning'
                              : 'outline'
                          }
                          className="text-[11px]"
                        >
                          {plugin.status === 'active'
                            ? '运行中'
                            : plugin.status === 'pending'
                            ? '待接入占位'
                            : '已停用'}
                        </Badge>
                      </div>
                    </div>

                    {/* Plugin Description */}
                    <p className="mt-3 text-xs text-ink-soft leading-relaxed line-clamp-2">
                      {plugin.description}
                    </p>

                    {/* Event Subscriptions Chips */}
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-ink-mute">订阅事件：</span>
                      {plugin.subscriptions.map((sub) => (
                        <span
                          key={sub}
                          className="rounded bg-surface-sunken px-1.5 py-0.5 text-[10px] font-mono text-ink-soft"
                        >
                          {sub}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Plugin Card Footer with Toggle & Selection Button */}
                  <div className="mt-4 flex items-center justify-between border-t border-hairline pt-3">
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <span className="text-xs text-ink-mute">许可协议：</span>
                      <Badge variant="outline" className="text-[10px]">
                        {plugin.license}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant={isSelected ? 'primary' : 'secondary'}
                        size="sm"
                        className="text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedPluginId(plugin.id);
                          setSearchParams({ plugin: plugin.id });
                        }}
                      >
                        {isSelected ? '✓ 当前展示区域' : '进入专区'}
                      </Button>
                    </div>
                  </div>
                </Card>
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected Plugin Dedicated Viewport */}
      <div className="rounded-2xl border border-hairline bg-surface p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between border-b border-hairline pb-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold uppercase tracking-wider text-accent">
              插件专区视图：
            </span>
            <h2 className="text-lg font-bold text-ink">{activePlugin.name}</h2>
          </div>
          <span className="text-xs text-ink-mute">
            来源：{activePlugin.author} ({activePlugin.license})
          </span>
        </div>

        {/* Plugin Render execution */}
        {activePlugin.enabled || activePlugin.status === 'pending' ? (
          (() => {
            const ActivePluginView = activePlugin.render;
            return (
              <ActivePluginView
                events={events}
                roles={roles}
                isSimulated={Object.keys(simulatedRoles).length > 0}
              />
            );
          })()
        ) : (
          <div className="py-12 text-center text-sm text-ink-mute">
            该插件已被停用，请在上方卡片中重新启用。
          </div>
        )}
      </div>
    </div>
  );
}
