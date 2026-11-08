import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Boxes,
  RotateCw,
  Sparkles,
  ExternalLink,
  Coffee,
  Flame,
  HelpCircle,
  PartyPopper,
  AlertTriangle,
  MessageSquare,
  CheckCircle2,
  Sliders,
  Code2,
} from 'lucide-react';
import { Badge, Button, Card, PageHeader } from '@/components/ui';
import { cn } from '@/lib/utils';
import { listRoles, type RoleInfo } from '@/api/roles';
import type { BothousePlugin, RoleEvent, RoleEventType } from './pluginInterface';
import { dshPetPlugin } from './plugins/dshPetPlugin';
import { personalityPlugin } from './plugins/personalityPlugin';

const DEFAULT_DEMO_ROLES: RoleInfo[] = [
  {
    name: 'gjiang',
    display_name: '大豆包',
    agent_type: 'frontend',
    model: 'gemini-3.8-flash',
    online: true,
    busy: true,
    current_task: '开发插件接口界面：统一事件与桌宠联动',
    paused: false,
    platforms: [{ name: 'discord', ready: true }],
    sessions_count: 5,
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
    sessions_count: 8,
  },
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
    sessions_count: 12,
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
    sessions_count: 4,
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
    sessions_count: 6,
  },
];

export default function PluginHubPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Plugin Registry
  const [plugins, setPlugins] = useState<BothousePlugin[]>([dshPetPlugin, personalityPlugin]);
  // Selected plugin id whose area is rendered below
  const [selectedPluginId, setSelectedPluginId] = useState<string>(
    searchParams.get('plugin') || 'dsh-pet'
  );

  // Unified Role Events Store
  const [events, setEvents] = useState<Record<string, RoleEvent>>({});
  // Current active simulation type on the interface page
  const [currentSimType, setCurrentSimType] = useState<RoleEventType | null>(null);

  const fetchRoles = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const res = await listRoles();
      if (res && Array.isArray(res.roles) && res.roles.length > 0) {
        setRoles(res.roles);
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
    if (currentSimType !== null) return;
    const initialEvents: Record<string, RoleEvent> = {};
    const now = new Date().toISOString();
    roles.forEach((r) => {
      let type: RoleEventType = 'idle';
      if (r.paused || !r.online) type = 'error';
      else if (r.busy) type = 'working';
      initialEvents[r.name] = {
        roleName: r.name,
        roleDisplayName: r.display_name,
        type,
        timestamp: now,
        task: r.current_task,
      };
    });
    setEvents(initialEvents);
  }, [roles, currentSimType]);

  // Emit unified event to all plugins
  const handleEmitGlobalEvent = (type: RoleEventType) => {
    setCurrentSimType(type);
    const now = new Date().toISOString();
    const updated: Record<string, RoleEvent> = {};
    roles.forEach((r) => {
      let speechText: string | undefined;
      if (type === 'speech') {
        speechText = `${r.display_name || r.name}：统一插件事件联动正常！`;
      }
      updated[r.name] = {
        roleName: r.name,
        roleDisplayName: r.display_name,
        type,
        timestamp: now,
        task: type === 'working' ? (r.current_task || '模拟推进重要特性开发') : undefined,
        speechText,
      };
    });
    setEvents(updated);
  };

  const handleResetLive = () => {
    setCurrentSimType(null);
  };

  const handleTogglePlugin = (pluginId: string) => {
    setPlugins((prev) =>
      prev.map((p) => {
        if (p.id === pluginId) {
          const nextEnabled = !p.enabled;
          return {
            ...p,
            enabled: nextEnabled,
            status: nextEnabled ? (p.status === 'pending' ? 'pending' : 'active') : 'disabled',
          };
        }
        return p;
      })
    );
  };

  const activePlugin = plugins.find((p) => p.id === selectedPluginId) || plugins[0];

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
            提供标准化插件接口（元数据声明、角色事件统一订阅推流），任何开源项目均可挂入本页面并联动角色。
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

      {/* Unified Role Event Simulator Bar */}
      <Card className="bg-surface p-4 shadow-sm ring-1 ring-hairline" data-testid="unified-simulator">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <Sliders size={16} className="text-accent" />
            <span className="text-xs font-semibold uppercase tracking-wider text-ink">
              统一角色事件模拟发射器：
            </span>
            {currentSimType ? (
              <Badge variant="warning" className="text-xs">
                正在广播：{currentSimType}
              </Badge>
            ) : (
              <Badge variant="success" className="text-xs">
                实时总线监听
              </Badge>
            )}
            <span className="text-[11px] text-ink-mute hidden sm:inline">
              （事件广播至所有订阅插件）
            </span>
          </div>

          {/* Unified Simulator Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={currentSimType === 'idle' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => handleEmitGlobalEvent('idle')}
              className="flex items-center gap-1 text-xs"
            >
              <Coffee size={13} />
              <span>待机呼吸</span>
            </Button>

            <Button
              variant={currentSimType === 'working' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => handleEmitGlobalEvent('working')}
              className="flex items-center gap-1 text-xs"
            >
              <Flame size={13} className="text-amber-500" />
              <span>干活中</span>
            </Button>

            <Button
              variant={currentSimType === 'thinking' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => handleEmitGlobalEvent('thinking')}
              className="flex items-center gap-1 text-xs"
            >
              <HelpCircle size={13} className="text-blue-500" />
              <span>思考中</span>
            </Button>

            <Button
              variant={currentSimType === 'celebrate' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => handleEmitGlobalEvent('celebrate')}
              className="flex items-center gap-1 text-xs"
            >
              <PartyPopper size={13} className="text-emerald-500" />
              <span>交活庆祝</span>
            </Button>

            <Button
              variant={currentSimType === 'error' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => handleEmitGlobalEvent('error')}
              className="flex items-center gap-1 text-xs"
            >
              <AlertTriangle size={13} className="text-red-500" />
              <span>出错/疲惫</span>
            </Button>

            <Button
              variant={currentSimType === 'speech' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => handleEmitGlobalEvent('speech')}
              className="flex items-center gap-1 text-xs"
            >
              <MessageSquare size={13} />
              <span>说了一句</span>
            </Button>

            {currentSimType !== null && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResetLive}
                className="text-xs text-ink-soft hover:text-ink"
              >
                恢复实时事件
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
                isSimulated={currentSimType !== null}
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
