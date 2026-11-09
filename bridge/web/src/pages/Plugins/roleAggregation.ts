import type { RoleInfo } from '@/api/roles';

export type RoleEventType = 'idle' | 'working' | 'thinking' | 'celebrate' | 'error' | 'speech';

export interface RoleSessionState {
  sessionId: string;
  type: RoleEventType;
  task?: string;
  speechText?: string;
  timestamp: string;
}

/**
 * 生成规范角色键：${source || 'bridge'}:${name}
 * 严禁使用 display_name 当键（避免同名串号），确保跨平台/源唯一。
 */
export function getRoleKey(roleOrName: { name: string; source?: string } | string, source?: string): string {
  if (typeof roleOrName === 'string') {
    if (roleOrName.includes(':')) return roleOrName;
    return `${source || 'bridge'}:${roleOrName}`;
  }
  return `${roleOrName.source || 'bridge'}:${roleOrName.name}`;
}

export const STATE_PRIORITY: Record<RoleEventType, number> = {
  error: 4,
  working: 3,
  thinking: 3,
  celebrate: 2,
  speech: 2,
  idle: 1,
};

/**
 * 合并同一角色多个会话的状态
 * 优先级：出错 (error) > 干活/思考 (working/thinking) > 庆祝 (celebrate) > 空闲 (idle)
 */
export function aggregateRoleStatus(
  sessions: RoleSessionState[] | undefined,
  fallbackStatus: RoleEventType = 'idle'
): RoleEventType {
  if (!sessions || sessions.length === 0) return fallbackStatus;

  let highestPriority = 0;
  let highestType: RoleEventType = fallbackStatus;

  for (const session of sessions) {
    const p = STATE_PRIORITY[session.type] ?? 0;
    if (p > highestPriority) {
      highestPriority = p;
      highestType = session.type;
    }
  }

  return highestType;
}

/**
 * 获取角色正在忙碌/干活的会话数
 */
export function getBusySessionCount(
  sessions: RoleSessionState[] | undefined,
  roleBusy?: boolean,
  sessionsCount?: number
): number {
  if (sessions && sessions.length > 0) {
    return sessions.filter((s) => s.type === 'working' || s.type === 'thinking').length;
  }
  if (roleBusy) {
    return Math.max(1, sessionsCount ?? 1);
  }
  return 0;
}

/**
 * 提取去重后的最新发言气泡文字
 */
export function getDeduplicatedSpeech(
  sessions: RoleSessionState[] | undefined,
  latestEvent?: { speechText?: string; timestamp?: string }
): string | undefined {
  if (!sessions || sessions.length === 0) {
    return latestEvent?.speechText;
  }

  const speeches = sessions
    .filter((s) => Boolean(s.speechText))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  if (speeches.length > 0) {
    return speeches[0].speechText;
  }
  return latestEvent?.speechText;
}
