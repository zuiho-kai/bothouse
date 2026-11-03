import { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Slash, Search, MessageSquarePlus, List, ArrowRightLeft, Eye, History,
  Square, Brain, Cpu, Languages, Layers, Activity, Stethoscope, Info,
  Settings, Timer, HeartPulse, Terminal, Tag, Wrench, Upload, Trash2,
  FolderOpen, HelpCircle, User, BookOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useChatCopy } from './copy';
import { fuzzyScore } from './parts/fuzzy';
import { pushRecent, readRecent } from './parts/recent';

export interface SlashCommand {
  cmd: string;
  labelKey: string;
  icon: React.ElementType;
  group: 'session' | 'settings' | 'info' | 'advanced';
  local?: boolean; // handled locally, not sent to bridge
}

export const slashCommands: SlashCommand[] = [
  // Session
  { cmd: '/new', labelKey: 'cmd.new', icon: MessageSquarePlus, group: 'session' },
  { cmd: '/list', labelKey: 'cmd.list', icon: List, group: 'session' },
  { cmd: '/switch', labelKey: 'cmd.switch', icon: ArrowRightLeft, group: 'session' },
  { cmd: '/current', labelKey: 'cmd.current', icon: Eye, group: 'session' },
  { cmd: '/history', labelKey: 'cmd.history', icon: History, group: 'session' },
  { cmd: '/stop', labelKey: 'cmd.stop', icon: Square, group: 'session' },
  // Settings
  { cmd: '/model', labelKey: 'cmd.model', icon: Brain, group: 'settings' },
  { cmd: '/reasoning', labelKey: 'cmd.reasoning', icon: Cpu, group: 'settings' },
  { cmd: '/mode', labelKey: 'cmd.mode', icon: Layers, group: 'settings' },
  { cmd: '/lang', labelKey: 'cmd.lang', icon: Languages, group: 'settings' },
  { cmd: '/provider', labelKey: 'cmd.provider', icon: Activity, group: 'settings' },
  // Info
  { cmd: '/status', labelKey: 'cmd.status', icon: Info, group: 'info' },
  { cmd: '/help', labelKey: 'cmd.help', icon: HelpCircle, group: 'info' },
  { cmd: '/doctor', labelKey: 'cmd.doctor', icon: Stethoscope, group: 'info' },
  { cmd: '/version', labelKey: 'cmd.version', icon: Tag, group: 'info' },
  { cmd: '/whoami', labelKey: 'cmd.whoami', icon: User, group: 'info' },
  { cmd: '/commands', labelKey: 'cmd.commands', icon: Terminal, group: 'info' },
  // Advanced
  { cmd: '/dir', labelKey: 'cmd.dir', icon: FolderOpen, group: 'advanced' },
  { cmd: '/cron', labelKey: 'cmd.cron', icon: Timer, group: 'advanced' },
  { cmd: '/heartbeat', labelKey: 'cmd.heartbeat', icon: HeartPulse, group: 'advanced' },
  { cmd: '/alias', labelKey: 'cmd.alias', icon: Tag, group: 'advanced' },
  { cmd: '/config', labelKey: 'cmd.config', icon: Settings, group: 'advanced' },
  { cmd: '/skills', labelKey: 'cmd.skills', icon: BookOpen, group: 'advanced' },
  { cmd: '/upgrade', labelKey: 'cmd.upgrade', icon: Upload, group: 'advanced' },
  { cmd: '/delete-mode', labelKey: 'cmd.deleteMode', icon: Trash2, group: 'advanced' },
];

const groupOrder: { key: string; labelKey: string }[] = [
  { key: 'session', labelKey: 'cmd.groupSession' },
  { key: 'settings', labelKey: 'cmd.groupSettings' },
  { key: 'info', labelKey: 'cmd.groupInfo' },
  { key: 'advanced', labelKey: 'cmd.groupAdvanced' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (cmd: SlashCommand) => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

interface Section {
  key: string;
  title: string;
  items: SlashCommand[];
}

export default function CommandPalette({ open, onClose, onSelect, anchorRef }: Props) {
  const { t } = useTranslation();
  const copy = useChatCopy();
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIdx(0);
    setRecent(readRecent());
    const id = setTimeout(() => searchRef.current?.focus(), 40);
    return () => clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node) &&
          anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open, onClose, anchorRef]);

  const sections = useMemo<Section[]>(() => {
    const q = query.trim();
    if (!q) {
      const out: Section[] = [];
      const recentCommands = recent
        .map((r) => slashCommands.find((c) => c.cmd === r))
        .filter((c): c is SlashCommand => !!c);
      if (recentCommands.length) out.push({ key: 'recent', title: copy.recentCommands, items: recentCommands });
      for (const g of groupOrder) {
        const items = slashCommands.filter((c) => c.group === g.key);
        if (items.length) out.push({ key: g.key, title: t(g.labelKey), items });
      }
      return out;
    }
    const scored = slashCommands
      .map((c) => ({
        cmd: c,
        score: Math.max(fuzzyScore(c.cmd, q), fuzzyScore(t(c.labelKey), q)),
      }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.cmd);
    return scored.length ? [{ key: 'match', title: copy.matches, items: scored }] : [];
  }, [query, recent, t, copy]);

  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);

  useEffect(() => {
    setActiveIdx((i) => Math.max(0, Math.min(i, flat.length - 1)));
  }, [flat.length]);

  const choose = (cmd: SlashCommand) => {
    setRecent(pushRecent(cmd.cmd));
    onSelect(cmd);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && flat[activeIdx]) {
      e.preventDefault();
      choose(flat[activeIdx]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!open) return null;

  let cursor = 0;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t('chat.commands')}
      className="ch-glass ch-enter absolute bottom-full left-0 z-50 mb-2 flex max-h-[420px] w-[320px] flex-col overflow-hidden rounded-[16px]"
      style={{ border: '1px solid var(--ch-line)', color: 'var(--ch-ink)' }}
    >
      <div className="px-3 pb-2 pt-3">
        <div
          className="flex items-center gap-2 rounded-[12px] px-2.5 py-2"
          style={{ background: 'var(--ch-sub)', boxShadow: 'inset 0 0 0 1px var(--ch-line)' }}
        >
          <Search size={14} className="shrink-0 text-[color:var(--ch-ink3)]" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
            onKeyDown={handleKeyDown}
            placeholder={t('cmd.search', 'Search commands...')}
            aria-label={t('cmd.search', 'Search commands...')}
            className="flex-1 bg-transparent text-[13px] text-[color:var(--ch-ink)] outline-none placeholder:text-[color:var(--ch-ink3)]"
          />
          <span className="shrink-0 rounded border border-[color:var(--ch-line)] px-1 text-[10px] text-[color:var(--ch-ink3)]">esc</span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {sections.map((section) => (
          <div key={section.key} className="mb-1">
            <div className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--ch-ink3)]">
              {section.title}
            </div>
            {section.items.map((cmd) => {
              const idx = cursor++;
              const Icon = cmd.icon;
              const active = idx === activeIdx;
              return (
                <button
                  key={`${section.key}-${cmd.cmd}`}
                  type="button"
                  onClick={() => choose(cmd)}
                  onMouseEnter={() => setActiveIdx(idx)}
                  className={cn(
                    'ch-focus flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13px] transition-colors',
                    active ? 'font-medium' : 'text-[color:var(--ch-ink2)]',
                  )}
                  style={active ? { background: 'var(--ch-active)', boxShadow: 'inset 2px 0 0 var(--ch-accent)' } : undefined}
                >
                  <Icon size={15} className={active ? 'text-[color:var(--ch-accent-ink)]' : 'text-[color:var(--ch-ink3)]'} />
                  <span className="w-[92px] shrink-0 text-left font-mono text-[12px] text-[color:var(--ch-ink3)]">{cmd.cmd}</span>
                  <span className="min-w-0 flex-1 truncate text-left">{t(cmd.labelKey)}</span>
                </button>
              );
            })}
          </div>
        ))}
        {sections.length === 0 && (
          <div className="py-6 text-center text-[13px] text-[color:var(--ch-ink3)]">{t('common.noData')}</div>
        )}
      </div>
      <div
        className="flex items-center gap-3 px-3 py-2 text-[10px] text-[color:var(--ch-ink3)]"
        style={{ borderTop: '1px solid var(--ch-line)' }}
      >
        <span>↑↓</span>
        <span>↵</span>
        <span className="ml-auto">/</span>
      </div>
    </div>
  );
}
