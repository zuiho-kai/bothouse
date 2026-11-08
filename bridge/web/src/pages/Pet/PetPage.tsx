import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RotateCw,
  Sparkles,
  Play,
  Pause,
  AlertCircle,
  CheckCircle2,
  Smile,
  Bot,
  MessageSquare,
  HelpCircle,
  Coffee,
  Flame,
  PartyPopper,
  AlertTriangle,
} from 'lucide-react';
import { Badge, Button, Card, PageHeader } from '@/components/ui';
import { cn } from '@/lib/utils';
import { listRoles, type RoleInfo } from '@/api/roles';

// Runtime assets from PC2005-cloud/dsh-pet (GitHub / jsDelivr)
// Notice: Assets are NEVER committed into bothouse repository.
const DSH_PET_CDN_BASE =
  'https://cdn.jsdelivr.net/gh/PC2005-cloud/dsh-pet@master/dsh-pet/assets/preview';

export type PetStateKey = 'idle' | 'working' | 'thinking' | 'celebrate' | 'error';

export interface PetAsset {
  key: PetStateKey;
  title: string;
  filename: string;
  url: string;
  badgeText: string;
  badgeVariant: 'default' | 'success' | 'warning' | 'danger' | 'info';
}

export const PET_ASSETS: Record<PetStateKey, PetAsset> = {
  idle: {
    key: 'idle',
    title: '待机呼吸',
    filename: 'daiji-huxi-xiuxian.gif',
    url: `${DSH_PET_CDN_BASE}/daiji-huxi-xiuxian.gif`,
    badgeText: '待机中',
    badgeVariant: 'default',
  },
  thinking: {
    key: 'thinking',
    title: '思考冒泡',
    filename: 'gongzuozhuangtai-sikao-maopao.gif',
    url: `${DSH_PET_CDN_BASE}/gongzuozhuangtai-sikao-maopao.gif`,
    badgeText: '思考中',
    badgeVariant: 'info',
  },
  working: {
    key: 'working',
    title: '忙碌点按',
    filename: 'gongzuozhuangtai-manglu-dianan.gif',
    url: `${DSH_PET_CDN_BASE}/gongzuozhuangtai-manglu-dianan.gif`,
    badgeText: '干活中',
    badgeVariant: 'info',
  },
  celebrate: {
    key: 'celebrate',
    title: '雀跃庆祝',
    filename: 'gongzuozhuangtai-queyue-qingzhu.gif',
    url: `${DSH_PET_CDN_BASE}/gongzuozhuangtai-queyue-qingzhu.gif`,
    badgeText: '交活庆祝',
    badgeVariant: 'success',
  },
  error: {
    key: 'error',
    title: '垂头冒汗',
    filename: 'gongzuozhuangtai-chuitou-tanqi-maohan.gif',
    url: `${DSH_PET_CDN_BASE}/gongzuozhuangtai-chuitou-tanqi-maohan.gif`,
    badgeText: '出错/冷却',
    badgeVariant: 'danger',
  },
};

const RANDOM_SAYINGS: Record<PetStateKey, string[]> = {
  idle: [
    '呼呼… 随时待命，有活喊我！',
    '稍微歇口气，喝口温水 🍵',
    '状态良好，准备好大显身手啦~',
    '今天也是元气满满的桌宠~',
  ],
  working: [
    '正在飞速敲键盘中… 噼里啪啦！',
    '专心干活，代码马上就好！',
    '全力推进中，细节严谨核验！',
    '任务进行中，勿扰正在冲刺 ⚡',
  ],
  thinking: [
    '让我仔细推演一下最佳方案… 💭',
    '梳理模块接口中，马上有思路！',
    '深度思考中，逻辑推演中…',
  ],
  celebrate: [
    '活交完啦！请老师验收~ 🎉',
    '顺利搞定！又是充满成就感的一天 ✨',
    '测试全部通过，交卷啦！',
  ],
  error: [
    '哎呀… 遇到点卡点，正在擦汗排查 💦',
    '额度好像冷却了，休息片刻马上爬起来！',
    '呜呜，这行代码怎么报错了，正在急救！',
  ],
};

const DEFAULT_DEMO_ROLES: RoleInfo[] = [
  {
    name: 'gjiang',
    display_name: '大豆包',
    agent_type: 'frontend',
    model: 'gemini-3.8-flash',
    online: true,
    busy: true,
    current_task: '急速开发桌宠插件演示页：面板内置大肥鱼',
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
];

export default function PetPage() {
  const { t } = useTranslation();
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Global override state for demonstration
  const [globalSimState, setGlobalSimState] = useState<PetStateKey | null>(null);
  // Per-role simulation override
  const [roleSimStates, setRoleSimStates] = useState<Record<string, PetStateKey>>({});
  // Per-role custom speech bubble
  const [customSayings, setCustomSayings] = useState<Record<string, string>>({});

  const fetchRoles = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const res = await listRoles();
      if (res && Array.isArray(res.roles) && res.roles.length > 0) {
        setRoles(res.roles);
      } else {
        // Use demo roles if API returns empty
        setRoles(DEFAULT_DEMO_ROLES);
      }
      setError(null);
    } catch (e: any) {
      console.warn('Failed to fetch live roles, using fallback roles for demo:', e);
      setRoles(DEFAULT_DEMO_ROLES);
      // Keep demo clean
      setError(null);
    } finally {
      setLoading(false);
      if (isManual) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchRoles();
    // Poll roles status every 4 seconds to reflect live changes
    const timer = setInterval(() => {
      fetchRoles();
    }, 4000);
    return () => clearInterval(timer);
  }, [fetchRoles]);

  // Determine pet state for a given role
  const getRolePetState = (role: RoleInfo): PetStateKey => {
    // 1. Check per-role manual simulation override
    if (roleSimStates[role.name]) {
      return roleSimStates[role.name];
    }
    // 2. Check global simulation override
    if (globalSimState) {
      return globalSimState;
    }
    // 3. Fall back to live role status
    if (role.paused || !role.online) {
      return 'error';
    }
    if (role.busy) {
      return 'working';
    }
    return 'idle';
  };

  // Determine speech bubble text
  const getBubbleText = (role: RoleInfo, state: PetStateKey): string => {
    if (customSayings[role.name]) {
      return customSayings[role.name];
    }
    if (state === 'working') {
      if (role.current_task && role.current_task.trim()) {
        return `正在干活：${role.current_task}`;
      }
      return '正在专注推进任务中… 噼里啪啦 ⚡';
    }
    const pool = RANDOM_SAYINGS[state] || RANDOM_SAYINGS.idle;
    // Consistent quote selection based on name length
    const idx = (role.name.charCodeAt(0) + state.length) % pool.length;
    return pool[idx];
  };

  const handleSimulateGlobal = (state: PetStateKey | null) => {
    setGlobalSimState(state);
    if (state === null) {
      setRoleSimStates({});
      setCustomSayings({});
    }
  };

  const handleSimulateRole = (roleName: string, state: PetStateKey) => {
    setRoleSimStates((prev) => ({ ...prev, [roleName]: state }));
  };

  const handleSayRandom = (roleName: string, state: PetStateKey) => {
    const pool = RANDOM_SAYINGS[state] || RANDOM_SAYINGS.idle;
    const randomQuote = pool[Math.floor(Math.random() * pool.length)];
    setCustomSayings((prev) => ({ ...prev, [roleName]: randomQuote }));
  };

  const handleSayAll = () => {
    const updated: Record<string, string> = {};
    roles.forEach((r) => {
      const state = getRolePetState(r);
      const pool = RANDOM_SAYINGS[state] || RANDOM_SAYINGS.idle;
      updated[r.name] = pool[Math.floor(Math.random() * pool.length)];
    });
    setCustomSayings(updated);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-hairline pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-ink">桌宠插件演示</h1>
            <Badge variant="info" className="flex items-center gap-1 font-semibold">
              <Sparkles size={12} />
              dsh-pet 联动原型
            </Badge>
          </div>
          <p className="mt-1 text-sm text-ink-soft">
            bothouse 面板内置大肥鱼桌宠组件，实时联动角色运行状态切动画与气泡。
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fetchRoles(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5"
          >
            <RotateCw size={14} className={cn(refreshing && 'animate-spin')} />
            <span>{refreshing ? '刷新中…' : '刷新角色状态'}</span>
          </Button>
        </div>
      </div>

      {/* Simulation Controls Toolbar */}
      <Card className="bg-surface p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
              全局演示模拟：
            </span>
            {globalSimState ? (
              <Badge variant="warning" className="text-xs">
                模拟中：{PET_ASSETS[globalSimState].title}
              </Badge>
            ) : (
              <Badge variant="success" className="text-xs">
                实时轮询联动
              </Badge>
            )}
          </div>

          {/* Quick Simulation Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={globalSimState === 'idle' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => handleSimulateGlobal('idle')}
              className="flex items-center gap-1 text-xs"
            >
              <Coffee size={13} />
              <span>待机呼吸</span>
            </Button>

            <Button
              variant={globalSimState === 'working' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => handleSimulateGlobal('working')}
              className="flex items-center gap-1 text-xs"
            >
              <Flame size={13} className="text-amber-500" />
              <span>忙碌干活</span>
            </Button>

            <Button
              variant={globalSimState === 'thinking' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => handleSimulateGlobal('thinking')}
              className="flex items-center gap-1 text-xs"
            >
              <HelpCircle size={13} className="text-blue-500" />
              <span>思考冒泡</span>
            </Button>

            <Button
              variant={globalSimState === 'celebrate' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => handleSimulateGlobal('celebrate')}
              className="flex items-center gap-1 text-xs"
            >
              <PartyPopper size={13} className="text-emerald-500" />
              <span>交活庆祝</span>
            </Button>

            <Button
              variant={globalSimState === 'error' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => handleSimulateGlobal('error')}
              className="flex items-center gap-1 text-xs"
            >
              <AlertTriangle size={13} className="text-red-500" />
              <span>出错/疲惫</span>
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={handleSayAll}
              className="flex items-center gap-1 text-xs"
            >
              <MessageSquare size={13} />
              <span>全员说一句</span>
            </Button>

            {globalSimState !== null && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleSimulateGlobal(null)}
                className="text-xs text-ink-soft hover:text-ink"
              >
                恢复实时轮询
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Role Cards Grid */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
        {roles.map((role) => {
          const petState = getRolePetState(role);
          const asset = PET_ASSETS[petState];
          const bubbleText = getBubbleText(role, petState);
          const isRoleSimulated = !!roleSimStates[role.name] || globalSimState !== null;

          return (
            <Card
              key={role.name}
              className={cn(
                'flex flex-col justify-between overflow-hidden border transition-all duration-200',
                role.busy && !isRoleSimulated && 'ring-1 ring-accent/30',
                petState === 'working' && 'border-accent/40 bg-accent-wash/5',
                petState === 'celebrate' && 'border-emerald-500/40 bg-emerald-500/5',
                petState === 'error' && 'border-red-500/30 bg-red-500/5'
              )}
            >
              <div>
                {/* Role Header */}
                <div className="flex items-start justify-between gap-2 border-b border-hairline pb-3">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-ink">
                        {role.display_name || role.name}
                      </span>
                      <span className="text-xs text-ink-mute">({role.name})</span>
                    </div>
                    <p className="mt-0.5 text-xs text-ink-soft font-mono">
                      {role.model || 'model'}
                    </p>
                  </div>
                  <Badge variant={asset.badgeVariant} className="shrink-0 text-[11px]">
                    {asset.badgeText}
                  </Badge>
                </div>

                {/* Pet Display Area with Speech Bubble */}
                <div className="flex flex-col items-center justify-center py-4">
                  {/* Speech Bubble */}
                  <div className="relative mb-3 flex w-full justify-center px-2">
                    <div className="relative max-w-[95%] rounded-2xl bg-surface-sunken px-3.5 py-2 text-center text-xs font-medium text-ink shadow-sm ring-1 ring-hairline">
                      <span className="break-words">{bubbleText}</span>
                      {/* Bubble Triangle Tail */}
                      <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 h-0 w-0 border-x-4 border-x-transparent border-t-[6px] border-t-surface-sunken" />
                    </div>
                  </div>

                  {/* Big Fat Fish Pet Gif Container */}
                  <div className="relative flex h-36 w-full items-center justify-center overflow-hidden rounded-xl bg-surface-sunken/40 p-2">
                    <img
                      src={asset.url}
                      alt={asset.title}
                      className="max-h-full max-w-full object-contain drop-shadow transition-transform duration-300 hover:scale-105"
                      loading="lazy"
                    />
                  </div>

                  {/* Current Activity Caption */}
                  <div className="mt-3 w-full px-1 text-center">
                    <p className="line-clamp-2 text-xs text-ink-soft">
                      {role.current_task ? (
                        <span className="text-ink font-medium">任务：{role.current_task}</span>
                      ) : (
                        <span>当前状态：{asset.title}</span>
                      )}
                    </p>
                  </div>
                </div>
              </div>

              {/* Per-card Simulation Action Buttons */}
              <div className="mt-2 border-t border-hairline pt-3">
                <div className="mb-1.5 flex items-center justify-between text-[11px] text-ink-mute">
                  <span>单角色模拟</span>
                  {roleSimStates[role.name] && (
                    <button
                      type="button"
                      onClick={() =>
                        setRoleSimStates((prev) => {
                          const copy = { ...prev };
                          delete copy[role.name];
                          return copy;
                        })
                      }
                      className="text-accent hover:underline"
                    >
                      恢复
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-5 gap-1 text-[11px]">
                  <button
                    type="button"
                    title="待机"
                    onClick={() => handleSimulateRole(role.name, 'idle')}
                    className={cn(
                      'rounded p-1 text-center hover:bg-surface-sunken transition-colors',
                      petState === 'idle' ? 'bg-surface-sunken font-bold text-ink' : 'text-ink-mute'
                    )}
                  >
                    待机
                  </button>
                  <button
                    type="button"
                    title="干活"
                    onClick={() => handleSimulateRole(role.name, 'working')}
                    className={cn(
                      'rounded p-1 text-center hover:bg-surface-sunken transition-colors',
                      petState === 'working' ? 'bg-surface-sunken font-bold text-accent' : 'text-ink-mute'
                    )}
                  >
                    干活
                  </button>
                  <button
                    type="button"
                    title="庆祝"
                    onClick={() => handleSimulateRole(role.name, 'celebrate')}
                    className={cn(
                      'rounded p-1 text-center hover:bg-surface-sunken transition-colors',
                      petState === 'celebrate' ? 'bg-surface-sunken font-bold text-emerald-600' : 'text-ink-mute'
                    )}
                  >
                    庆祝
                  </button>
                  <button
                    type="button"
                    title="出错"
                    onClick={() => handleSimulateRole(role.name, 'error')}
                    className={cn(
                      'rounded p-1 text-center hover:bg-surface-sunken transition-colors',
                      petState === 'error' ? 'bg-surface-sunken font-bold text-red-600' : 'text-ink-mute'
                    )}
                  >
                    出错
                  </button>
                  <button
                    type="button"
                    title="说一句"
                    onClick={() => handleSayRandom(role.name, petState)}
                    className="rounded p-1 text-center hover:bg-surface-sunken transition-colors text-ink-soft font-medium"
                  >
                    冒泡
                  </button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Footer Attribution & License Notice */}
      <div className="mt-8 rounded-card border border-hairline bg-surface p-4 text-xs text-ink-soft">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <p>
            桌宠素材形象出处：
            <a
              href="https://github.com/PC2005-cloud/dsh-pet"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline hover:opacity-80 ml-1"
            >
              PC2005-cloud/dsh-pet (GitHub)
            </a>
            ，遵循{' '}
            <span className="font-semibold text-ink">CC BY-NC-SA 4.0</span> 知识共享署名-非商业性使用-相同方式共享许可协议。
          </p>
          <span className="text-ink-mute">
            素材通过 jsDelivr CDN 运行时加载，不随 bothouse 仓库打包或分发
          </span>
        </div>
      </div>
    </div>
  );
}
