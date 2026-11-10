import { withBase } from '@/lib/basePath';

export interface RoleAvatarMatchOptions {
  avatar?: string;
  model?: string;
  agentType?: string;
  name?: string;
}

/**
 * Maps role metadata (model family, agent type, persona identity, or custom avatar)
 * to an avatar URL.
 * 
 * Rules:
 * 1. User custom avatar (url, upload, or custom slug) has highest priority.
 * 2. Grok has no selected asset in the B-set; must never borrow another's asset -> undefined fallback.
 * 3. Model family matches:
 *    - Claude -> orange.png (B版 Q版持书橙发少女)
 *    - GPT / Codex -> dragon.png (B版 Q版白发龙娘)
 *    - DeepSeek -> whale.png (B版 Q版蓝发女仆)
 *    - Gemini -> rainbow.png (B版 Q版紫发猫娘)
 * 4. Agent type / CLI matches:
 *    - claudecode / claude -> orange.png
 *    - codex -> dragon.png
 *    - deepseek / dsh -> whale.png
 *    - antigravity / gemini -> rainbow.png
 * 5. Persona identity / role name matches:
 *    - 橘 / C酱 / cjiang / claude -> orange.png
 *    - 龙娘 / G哥 / gge / codex / gpt -> dragon.png
 *    - 鲸鱼娘 / 肥鱼 / deep / deepseek / dsh -> whale.png
 *    - 彩虹猫 / 大豆包 / gjiang / gemini -> rainbow.png
 *    - 岚汐 / lanxi / minimax -> lanxi.png
 * 6. Fallback: undefined -> letter disc
 */
export function resolveRoleAvatar(opts?: RoleAvatarMatchOptions | string): string | undefined {
  if (!opts) return undefined;
  const o: RoleAvatarMatchOptions = typeof opts === 'string' ? { name: opts } : opts;

  // 1. User custom avatar
  if (o.avatar) {
    const a = o.avatar.trim();
    if (a.startsWith('http://') || a.startsWith('https://') || a.startsWith('data:') || a.startsWith('/')) {
      return a;
    }
    if (a === 'orange' || a === 'dragon' || a === 'whale' || a === 'rainbow' || a === 'lanxi' || a === 'grok') {
      return withBase(`/avatars/${a}.png`);
    }
    return withBase(`/api/v1/library/avatar-image/${encodeURIComponent(a)}`);
  }

  const model = (o.model || '').toLowerCase();
  const agentType = (o.agentType || '').toLowerCase();
  const name = (o.name || '').toLowerCase();

  // 2. Model family
  if (model) {
    if (model.includes('claude') || model.includes('opus') || model.includes('sonnet') || model.includes('haiku')) {
      return withBase('/avatars/orange.png');
    }
    if (model.includes('gpt') || model.includes('codex') || model.includes('o1') || model.includes('o3') || model.includes('o4') || model.includes('chatgpt')) {
      return withBase('/avatars/dragon.png');
    }
    if (model.includes('deepseek') || model.includes('r1') || model.includes('v3')) {
      return withBase('/avatars/whale.png');
    }
    if (model.includes('gemini')) {
      return withBase('/avatars/rainbow.png');
    }
    if (model.includes('grok') || model.includes('xai')) {
      return withBase('/avatars/grok.png');
    }
  }

  // 3. Agent type / CLI
  if (agentType) {
    if (agentType === 'claudecode' || agentType === 'claude') {
      return withBase('/avatars/orange.png');
    }
    if (agentType === 'codex') {
      return withBase('/avatars/dragon.png');
    }
    if (agentType === 'deepseek' || agentType === 'dsh') {
      return withBase('/avatars/whale.png');
    }
    if (agentType === 'antigravity' || agentType === 'gemini') {
      return withBase('/avatars/rainbow.png');
    }
    if (agentType === 'grok') {
      return withBase('/avatars/grok.png');
    }
  }

  // 4. Persona identity / role name
  if (name) {
    if (name === '橘' || name === 'c酱' || name === 'cjiang' || name === 'claude') {
      return withBase('/avatars/orange.png');
    }
    if (name === '龙娘' || name === 'g哥' || name === 'gge' || name === 'codex' || name === 'gpt') {
      return withBase('/avatars/dragon.png');
    }
    if (name === '鲸鱼娘' || name === '肥鱼' || name === 'deep' || name === 'deepseek' || name === 'dsh') {
      return withBase('/avatars/whale.png');
    }
    if (name === '彩虹猫' || name === '大豆包' || name === 'gjiang' || name === 'gemini') {
      return withBase('/avatars/rainbow.png');
    }
    if (name === '岚汐' || name === 'lanxi' || name === 'minimax') {
      return withBase('/avatars/lanxi.png');
    }
    if (name === 'grok' || name.includes('grok')) {
      return withBase('/avatars/grok.png');
    }
  }

  return undefined;
}
