import type { ReactNode } from 'react';
import type { RoleInfo } from '@/api/roles';

/**
 * 最小插件接口 (Minimal Plugin Interface)
 *
 * 规范：
 * 1. 插件声明：元数据（名称、作者、仓库、许可、版本、描述）及所订阅的角色事件列表。
 * 2. 角色事件统一格式：包含触发角色、事件类型、时间戳、任务说明或发言文本。
 * 3. 插件渲染：接口页向插件传入当前所有角色的最新事件与状态，插件在自己的区域内渲染。
 */

export type RoleEventType = 'idle' | 'working' | 'thinking' | 'celebrate' | 'error' | 'speech';

export interface RoleEvent {
  roleName: string;
  roleDisplayName?: string;
  type: RoleEventType;
  timestamp: string;
  task?: string;
  speechText?: string;
}

export interface BothousePluginMeta {
  id: string;
  name: string;
  author: string;
  repo: string;
  license: string;
  version: string;
  description: string;
  subscriptions: RoleEventType[];
  enabled: boolean;
  status: 'active' | 'pending' | 'disabled';
}

export interface PluginRenderProps {
  events: Record<string, RoleEvent>;
  roles: RoleInfo[];
  isSimulated: boolean;
  onEmitEvent?: (event: RoleEvent) => void;
}

export interface BothousePlugin extends BothousePluginMeta {
  render: (props: PluginRenderProps) => ReactNode;
}
