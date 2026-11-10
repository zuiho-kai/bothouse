import { useEffect } from 'react';
import { create } from 'zustand';
import { withBase } from '@/lib/basePath';
import { getGlobalSettings, updateGlobalSettings } from '@/api/settings';

export interface RoleAvatarMatchOptions {
  avatar?: string;
  model?: string;
  agentType?: string;
  name?: string;
}

/**
 * Two built-in avatar sets (user 2026-11-10「默认是各家原本的图标，内置另一套娘化图标」):
 * - brand: each vendor's own icon (default), from @lobehub/icons-static-png, see public/avatars/README.md
 * - chibi: the built-in Q-style character set
 * Stored once in the bridge config ([display] avatar_style) so the web panel and the DSH plugin agree.
 */
export type AvatarStyle = 'brand' | 'chibi';
export const AVATAR_STYLES: AvatarStyle[] = ['brand', 'chibi'];
export const DEFAULT_AVATAR_STYLE: AvatarStyle = 'brand';

export type AvatarFamily = 'claude' | 'gpt' | 'deepseek' | 'gemini' | 'grok' | 'minimax';

/** Image slug (file name under /avatars without .png) of each family in each set. */
export const AVATAR_SETS: Record<AvatarStyle, Record<AvatarFamily, string>> = {
  brand: {
    claude: 'brand-claude',
    gpt: 'brand-openai',
    deepseek: 'brand-deepseek',
    gemini: 'brand-gemini',
    grok: 'brand-grok',
    minimax: 'brand-minimax',
  },
  chibi: {
    claude: 'orange',
    gpt: 'dragon',
    deepseek: 'whale',
    gemini: 'rainbow',
    grok: 'grok',
    minimax: 'lanxi',
  },
};

/** Slugs a user may pick for one role; a pick always wins over the set (custom avatar priority). */
const BUILTIN_SLUGS = new Set<string>([...Object.values(AVATAR_SETS.brand), ...Object.values(AVATAR_SETS.chibi)]);

export function normalizeAvatarStyle(v: unknown): AvatarStyle {
  return v === 'chibi' ? 'chibi' : DEFAULT_AVATAR_STYLE;
}

/** Tells a DSH channel page in this origin (the panel embedded at /collab/panel/) to follow a switch. */
function announceAvatarStyle(style: AvatarStyle) {
  try {
    const ch = new BroadcastChannel('bothouse-avatar-style'); // dsh client-ui-discord avatar-style.ts
    ch.postMessage(style);
    ch.close();
  } catch {
    // no BroadcastChannel: the DSH page picks the switch up on its next load
  }
}

interface AvatarStyleState {
  style: AvatarStyle;
  loaded: boolean;
  load: () => Promise<void>;
  setStyle: (s: AvatarStyle) => Promise<void>;
}

export const useAvatarStyleStore = create<AvatarStyleState>((set, get) => ({
  style: DEFAULT_AVATAR_STYLE,
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    set({ loaded: true });
    try {
      const s = await getGlobalSettings();
      set({ style: normalizeAvatarStyle(s.avatar_style) });
    } catch {
      // settings unreachable: keep the default set
    }
  },
  setStyle: async (style) => {
    const prev = get().style;
    set({ style });
    try {
      await updateGlobalSettings({ avatar_style: style });
      announceAvatarStyle(style);
    } catch (e) {
      set({ style: prev });
      throw e;
    }
  },
}));

/** Current avatar set; subscribes the component so avatars change together when it is switched. */
export function useAvatarStyle(): AvatarStyle {
  const style = useAvatarStyleStore((s) => s.style);
  useEffect(() => { void useAvatarStyleStore.getState().load(); }, []);
  return style;
}

/**
 * Model family of a role from its model, agent type / CLI, or persona name. Rules in order:
 * 1. Model: claude/opus/sonnet/haiku; gpt/codex/o1/o3/o4/chatgpt; deepseek/r1/v3; gemini; grok/xai
 * 2. Agent type: claudecode/claude; codex; deepseek/dsh; antigravity/gemini; grok
 * 3. Name: 橘/C酱/cjiang/claude; 龙娘/G哥/gge/codex/gpt; 鲸鱼娘/肥鱼/deep/deepseek/dsh;
 *    彩虹猫/大豆包/gjiang/gemini; 岚汐/lanxi/minimax; *grok*
 */
export function matchAvatarFamily(o: Omit<RoleAvatarMatchOptions, 'avatar'>): AvatarFamily | undefined {
  const model = (o.model || '').toLowerCase();
  const agentType = (o.agentType || '').toLowerCase();
  const name = (o.name || '').toLowerCase();

  if (model) {
    if (model.includes('claude') || model.includes('opus') || model.includes('sonnet') || model.includes('haiku')) return 'claude';
    if (model.includes('gpt') || model.includes('codex') || model.includes('o1') || model.includes('o3') || model.includes('o4') || model.includes('chatgpt')) return 'gpt';
    if (model.includes('deepseek') || model.includes('r1') || model.includes('v3')) return 'deepseek';
    if (model.includes('gemini')) return 'gemini';
    if (model.includes('grok') || model.includes('xai')) return 'grok';
  }

  if (agentType) {
    if (agentType === 'claudecode' || agentType === 'claude') return 'claude';
    if (agentType === 'codex') return 'gpt';
    if (agentType === 'deepseek' || agentType === 'dsh') return 'deepseek';
    if (agentType === 'antigravity' || agentType === 'gemini') return 'gemini';
    if (agentType === 'grok') return 'grok';
  }

  if (name) {
    if (name === '橘' || name === 'c酱' || name === 'cjiang' || name === 'claude') return 'claude';
    if (name === '龙娘' || name === 'g哥' || name === 'gge' || name === 'codex' || name === 'gpt') return 'gpt';
    if (name === '鲸鱼娘' || name === '肥鱼' || name === 'deep' || name === 'deepseek' || name === 'dsh') return 'deepseek';
    if (name === '彩虹猫' || name === '大豆包' || name === 'gjiang' || name === 'gemini') return 'gemini';
    if (name === '岚汐' || name === 'lanxi' || name === 'minimax') return 'minimax';
    if (name.includes('grok')) return 'grok';
  }

  return undefined;
}

/**
 * Maps role metadata to an avatar URL.
 * 1. User custom avatar (url, upload, built-in slug, or library avatar) has highest priority.
 * 2. Otherwise the role's model family in the current set (`style`, default: the selected set).
 * 3. No family: undefined -> letter disc.
 */
export function resolveRoleAvatar(opts?: RoleAvatarMatchOptions | string, style?: AvatarStyle): string | undefined {
  if (!opts) return undefined;
  const o: RoleAvatarMatchOptions = typeof opts === 'string' ? { name: opts } : opts;

  if (o.avatar) {
    const a = o.avatar.trim();
    if (a.startsWith('http://') || a.startsWith('https://') || a.startsWith('data:') || a.startsWith('/')) {
      return a;
    }
    if (BUILTIN_SLUGS.has(a)) {
      return withBase(`/avatars/${a}.png`);
    }
    return withBase(`/api/v1/library/avatar-image/${encodeURIComponent(a)}`);
  }

  const family = matchAvatarFamily(o);
  if (!family) return undefined;
  const set = AVATAR_SETS[style ?? useAvatarStyleStore.getState().style];
  return withBase(`/avatars/${set[family]}.png`);
}
