import type { ReactNode } from 'react';
import type { RoleInfo } from '@/api/roles';
import type { RoleEventType, RoleSessionState } from './roleAggregation';

export type { RoleEventType, RoleSessionState } from './roleAggregation';
export { aggregateRoleStatus, getBusySessionCount, getDeduplicatedSpeech, getRoleKey, STATE_PRIORITY } from './roleAggregation';

/**
 * 最小插件接口 (Minimal Plugin Interface)
 *
 * 规范：
 * 1. 插件声明：元数据（名称、作者、仓库、许可、版本、描述）及所订阅的角色事件列表。
 * 2. 角色事件统一格式：包含唯一角色键 roleKey (source:name)、触发角色名、事件类型、时间戳、任务说明或发言文本。
 * 3. 插件渲染：接口页向插件传入按 roleKey 分好的事件状态表与角色列表，插件在自己的区域内渲染。
 */

export interface ExtendedRoleInfo extends RoleInfo {
  source?: string;
  active_sessions?: RoleSessionState[];
}

export interface RoleEvent {
  roleKey: string; // e.g. "bridge:deep" or "dsh:deep"
  roleName: string; // e.g. "deep"
  source?: string; // e.g. "bridge" or "dsh"
  roleDisplayName?: string;
  type: RoleEventType;
  timestamp: string;
  task?: string;
  speechText?: string;
  sessionId?: string;
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
  roles: ExtendedRoleInfo[];
  isSimulated: boolean;
  onEmitEvent?: (event: RoleEvent) => void;
}

export interface BothousePlugin extends BothousePluginMeta {
  render: (props: PluginRenderProps) => ReactNode;
}
