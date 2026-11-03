import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, ArrowDown, Send, User, Bot, Circle, WifiOff,
  Copy, Check, FileText, Image as ImageIcon, Loader2,
  Slash, ChevronDown, Smile, Plus,
} from 'lucide-react';
import { listSessions, getSession, type Session, type SessionDetail } from '@/api/sessions';
import { getProject, shownName } from '@/api/projects';
import {
  useBridgeSocket, fetchBridgeConfig,
  type BridgeConfig, type BridgeIncoming, type BridgeStatus,
} from '@/hooks/useBridgeSocket';
import CommandPalette, { type SlashCommand, slashCommands } from './CommandPalette';
import SessionDrawer from './SessionDrawer';
import CommandResultPanel, { type CommandResult } from './CommandResultPanel';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { cn } from '@/lib/utils';
import Avatar from './parts/Avatar';
import { formatClock, formatDayLabel, useChatCopy } from './copy';
import './chat.css';

// The composer grows with its text up to six lines, then scrolls (a message longer than that is
// easier to read in the stream than in the box).
const COMPOSER_MAX_ROWS = 6;
// A scroll position within this many pixels of the bottom still counts as "following the stream";
// about half a bubble, so a little slack never stops the auto-follow.
const STICK_SLACK_PX = 80;
const EMOJI = ['😀', '😄', '😊', '🙂', '😉', '😍', '🤔', '😅', '😮', '😢', '😭', '😂', '👍', '👌', '🙏', '💪', '🎉', '🔥', '✅', '❌', '❤️', '⭐', '🚀', '☕'];

// ── Markdown renderers ───────────────────────────────────────

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="ch-focus absolute right-2 top-2 z-10 rounded-md bg-[var(--ch-sub)] p-1.5 text-[color:var(--ch-ink3)] opacity-0 transition-opacity hover:text-[color:var(--ch-ink)] group-hover:opacity-100"
      title="Copy"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

function PreBlock({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) {
  const codeEl = (children as any)?.props;
  const lang = codeEl?.className?.replace(/^language-/, '') || '';
  const code = typeof codeEl?.children === 'string' ? codeEl.children.replace(/\n$/, '') : '';
  return (
    <div className="not-prose group relative my-3">
      {lang && (
        <div className="absolute left-0 top-0 rounded-tl-lg rounded-br-lg border-b border-r border-[color:var(--ch-line)] bg-[var(--ch-sub)] px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-wider text-[color:var(--ch-ink3)]">
          {lang}
        </div>
      )}
      <CopyButton code={code} />
      <pre
        className="overflow-x-auto rounded-[14px] border border-[color:var(--ch-line)] bg-[var(--ch-sub)] p-4 pt-8 font-mono text-[13px] leading-[1.6]"
        {...props}
      >
        {children}
      </pre>
    </div>
  );
}

function InlineCode({ children, className, ...props }: React.HTMLAttributes<HTMLElement>) {
  if (className) return <code className={className} {...props}>{children}</code>;
  return (
    <code
      className="rounded-md border border-[color:var(--ch-line)] bg-[var(--ch-sub)] px-1.5 py-0.5 font-mono text-[0.875em] text-[color:var(--ch-accent-ink)]"
      {...props}
    >
      {children}
    </code>
  );
}

function RenderMarkdown({ content }: { content: string }) {
  return (
    <div className={cn(
      'prose max-w-none dark:prose-invert',
      'prose-headings:font-semibold prose-headings:tracking-tight',
      'prose-h1:text-xl prose-h1:mt-5 prose-h1:mb-3 prose-h1:pb-1.5 prose-h1:border-b prose-h1:border-[color:var(--ch-line)]',
      'prose-h2:text-lg prose-h2:mt-5 prose-h2:mb-2',
      'prose-h3:text-base prose-h3:mt-4 prose-h3:mb-2',
      'prose-p:my-2.5 prose-p:leading-[22px]',
      'prose-li:my-0.5', 'prose-ul:my-2 prose-ol:my-2',
      'prose-a:text-accent prose-a:no-underline hover:prose-a:underline',
      'prose-strong:font-semibold',
      'prose-blockquote:border-l-[3px] prose-blockquote:border-accent/40 prose-blockquote:bg-accent/[0.04] prose-blockquote:rounded-r-lg prose-blockquote:py-0.5 prose-blockquote:px-4 prose-blockquote:my-3 prose-blockquote:not-italic',
      'prose-hr:my-5 prose-hr:border-[color:var(--ch-line)]',
      'prose-table:text-sm prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-2',
      'prose-img:rounded-lg prose-img:shadow-sm',
    )}>
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={{ pre: PreBlock as any, code: InlineCode as any }}>
        {content}
      </Markdown>
    </div>
  );
}

// ── Chat message types ───────────────────────────────────────

interface ChatMsg {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  format?: 'text' | 'markdown' | 'card' | 'buttons' | 'image' | 'file';
  card?: any;
  buttons?: { text: string; data: string }[][];
  imageUrl?: string;
  fileName?: string;
  fileSize?: number;
  streaming?: boolean;
  timestamp?: string;
  /** Epoch ms; every message gets one at creation so ordering and day breaks are stable. */
  ts: number;
}

function tsOf(iso?: string): number {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isNaN(t) ? Date.now() : t;
}

// ── Helpers ──────────────────────────────────────────────────

function parseListItemText(text: string): { cmd: string; desc: string } {
  const m = text.match(/^\*\*(.+?)\*\*\s*(.*)/);
  if (m) return { cmd: m[1], desc: m[2] };
  const sp = text.indexOf(' ');
  if (sp > 0) return { cmd: text.slice(0, sp), desc: text.slice(sp + 1) };
  return { cmd: text, desc: '' };
}

function InlineMd({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**')
          ? <strong key={i} className="font-semibold">{p.slice(2, -2)}</strong>
          : <span key={i}>{p}</span>
      )}
    </>
  );
}

// ── Card renderer (flat, clean style for in-stream cards) ────

function CardBlock({ card, onAction }: { card: any; onAction: (v: string) => void }) {
  if (!card) return null;
  return (
    <div className="space-y-3">
      {card.header?.title && (
        <div className="text-sm font-semibold">{card.header.title}</div>
      )}
      {card.elements?.map((el: any, i: number) => (
        <CardElement key={i} el={el} onAction={onAction} />
      ))}
    </div>
  );
}

function CardElement({ el, onAction }: { el: any; onAction: (v: string) => void }) {
  if (el.type === 'markdown') return <RenderMarkdown content={el.content} />;
  if (el.type === 'divider') return <div className="border-t border-[color:var(--ch-line)]" />;
  if (el.type === 'note') return <p className="text-[11px] text-[color:var(--ch-ink3)]">{el.text}</p>;
  if (el.type === 'actions') {
    return (
      <div className="flex flex-wrap gap-2">
        {el.buttons?.map((btn: any, j: number) => (
          <button
            key={j}
            onClick={() => onAction(btn.value)}
            className={cn(
              'ch-focus rounded-[10px] px-3 py-1.5 text-xs font-semibold transition-all duration-150',
              btn.btn_type === 'primary'
                ? 'bg-[var(--ch-accent)] text-black hover:brightness-[1.04]'
                : 'text-[color:var(--ch-ink2)] hover:text-[color:var(--ch-ink)]',
            )}
            style={btn.btn_type === 'primary' ? undefined : { boxShadow: 'inset 0 0 0 1px var(--ch-edge)' }}
          >
            {btn.text}
          </button>
        ))}
      </div>
    );
  }
  if (el.type === 'list_item') {
    const parsed = parseListItemText(el.text);
    const isCommand = parsed.cmd.startsWith('/');
    return (
      <button onClick={() => onAction(el.btn_value)} className="ch-focus group flex w-full items-center gap-3 py-2 text-left">
        {isCommand ? (
          <>
            <code className="w-20 shrink-0 font-mono text-xs font-medium text-[color:var(--ch-accent-ink)]">{parsed.cmd}</code>
            <span className="flex-1 truncate text-sm text-[color:var(--ch-ink2)]">{parsed.desc}</span>
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm text-[color:var(--ch-ink2)]">
            <InlineMd text={el.text} />
          </span>
        )}
        <span
          className={cn(
            'shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium transition-all',
            el.btn_type === 'primary'
              ? 'bg-accent/15 text-[color:var(--ch-accent-ink)] group-hover:bg-accent/25'
              : 'text-[color:var(--ch-ink3)] group-hover:bg-accent/15 group-hover:text-[color:var(--ch-accent-ink)]',
          )}
          style={el.btn_type === 'primary' ? undefined : { boxShadow: 'inset 0 0 0 1px var(--ch-line)' }}
        >
          {el.btn_text}
        </span>
      </button>
    );
  }
  if (el.type === 'select') {
    return (
      <select
        defaultValue={el.init_value}
        onChange={(e) => onAction(e.target.value)}
        className="w-full rounded-[12px] border border-[color:var(--ch-edge)] bg-[var(--ch-panel)] px-3 py-2 text-sm text-[color:var(--ch-ink)] focus:outline-none focus:ring-2 focus:ring-accent/40"
      >
        {el.options?.map((opt: any, j: number) => (
          <option key={j} value={opt.value}>{opt.text}</option>
        ))}
      </select>
    );
  }
  return null;
}

function ButtonsBlock({ content, buttons, onAction }: { content: string; buttons: { text: string; data: string }[][]; onAction: (v: string) => void }) {
  return (
    <div className="space-y-3">
      <RenderMarkdown content={content} />
      {buttons.map((row, i) => (
        <div key={i} className="flex flex-wrap gap-2">
          {row.map((btn, j) => (
            <button
              key={j}
              onClick={() => onAction(btn.data)}
              className="ch-focus rounded-[10px] bg-[var(--ch-accent)] px-3 py-1.5 text-xs font-semibold text-black transition-[filter] hover:brightness-[1.04]"
            >
              {btn.text}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function FileBlock({ name, size }: { name: string; size?: number }) {
  return (
    <div className="flex items-center gap-2 rounded-[12px] border border-[color:var(--ch-line)] bg-[var(--ch-sub)] px-3 py-2">
      <FileText size={16} className="shrink-0 text-[color:var(--ch-ink3)]" />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{name}</div>
        {size !== undefined && <div className="text-xs text-[color:var(--ch-ink3)]">{(size / 1024).toFixed(1)} KB</div>}
      </div>
    </div>
  );
}

function ImageBlock({ url }: { url: string }) {
  return <img src={url} alt="" className="max-w-sm rounded-[12px] border border-[color:var(--ch-line)]" />;
}

function StatusBadge({ status }: { status: BridgeStatus }) {
  const { t } = useTranslation();
  if (status === 'connected') {
    return (
      <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
        <Circle size={5} className="fill-current" /> {t('sessions.bridgeConnected')}
      </span>
    );
  }
  if (status === 'connecting' || status === 'registering') {
    return (
      <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
        <Loader2 size={9} className="animate-spin" /> {t('sessions.bridgeConnecting')}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 rounded-full bg-[var(--ch-hover)] px-2 py-0.5 text-[10px] font-medium text-[color:var(--ch-ink3)]">
      <WifiOff size={9} /> {t('sessions.bridgeDisconnected')}
    </span>
  );
}

function MsgCopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="ch-focus absolute -top-2 right-2 rounded-full bg-[var(--ch-panel)] p-1 text-[color:var(--ch-ink3)] opacity-0 shadow-[var(--ch-e1)] transition-opacity hover:text-[color:var(--ch-ink)] group-hover/msg:opacity-100 focus-visible:opacity-100"
      title={copied ? label : label}
      aria-label={label}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

// ── Main component ───────────────────────────────────────────

export default function ChatView() {
  const { t } = useTranslation();
  const copy = useChatCopy();
  const { name: projectName } = useParams<{ name: string }>();
  const [shown, setShown] = useState('');
  useEffect(() => {
    setShown('');
    if (projectName) getProject(projectName).then((p) => setShown(shownName(p))).catch(() => {});
  }, [projectName]);

  // Session state
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSession, setCurrentSession] = useState<SessionDetail | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [typing, setTyping] = useState(false);
  const [bridgeCfg, setBridgeCfg] = useState<BridgeConfig | null>(null);
  // Whether the user explicitly picked a session from the drawer
  const [userPickedSession, setUserPickedSession] = useState(false);

  // UI state
  const [cmdOpen, setCmdOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [cmdResult, setCmdResult] = useState<CommandResult | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const [unread, setUnread] = useState(0);

  const messagesEnd = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const previewHandleCounter = useRef(0);
  const cmdBtnRef = useRef<HTMLButtonElement>(null);
  const sessionKeyRef = useRef('');
  // Track pending slash command so the next reply can be routed to the panel
  const pendingCmdRef = useRef<string | null>(null);
  // Mirrors cmdResult.command so card-action callbacks can route follow-ups back to the panel
  const cmdPanelRef = useRef<string | null>(null);
  // True while the reader is at the bottom and wants new messages to arrive in view.
  const stickRef = useRef(true);

  // Web platform uses its own per-project session key by default.
  // Only use the original session's key when the user explicitly switches via the drawer.
  const webSessionKey = projectName ? `bridge:web-admin:${projectName}` : '';
  const sessionKey = userPickedSession && currentSession?.session_key
    ? currentSession.session_key
    : webSessionKey;
  sessionKeyRef.current = sessionKey;

  const toMessages = (history: { role: string; content: string; timestamp: string }[]) =>
    history.map((h, i) => ({
      id: `hist-${i}`,
      role: h.role as 'user' | 'assistant',
      content: h.content,
      format: 'markdown' as const,
      timestamp: h.timestamp,
      ts: tsOf(h.timestamp),
    }));

  // Load project sessions and auto-select latest
  const fetchData = useCallback(async () => {
    if (!projectName) return;
    setLoading(true);
    try {
      const [{ sessions: allSessions }, cfg] = await Promise.all([
        listSessions(projectName),
        fetchBridgeConfig(),
      ]);
      setBridgeCfg(cfg);
      const sorted = (allSessions || []).sort(
        (a, b) => (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || ''),
      );
      setSessions(sorted);

      if (sorted.length > 0) {
        const latest = sorted[0];
        const detail = await getSession(projectName, latest.id, 200);
        setCurrentSession(detail);
        if (detail.history) setMessages(toMessages(detail.history));
      } else {
        setCurrentSession(null);
        setMessages([]);
      }
    } finally {
      setLoading(false);
    }
    stickRef.current = true;
    setAwayFromBottom(false);
    setUnread(0);
  }, [projectName]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Keep ref in sync with cmdResult so callbacks avoid stale closures
  useEffect(() => {
    cmdPanelRef.current = cmdResult?.command ?? null;
  }, [cmdResult]);

  // Switch to a different session (user explicitly chose from drawer)
  const switchToSession = useCallback(async (s: Session) => {
    if (!projectName) return;
    setDrawerOpen(false);
    setLoading(true);
    setUserPickedSession(true);
    try {
      const detail = await getSession(projectName, s.id, 200);
      setCurrentSession(detail);
      if (detail.history) setMessages(toMessages(detail.history));
      else setMessages([]);
    } finally {
      setLoading(false);
    }
    stickRef.current = true;
    setAwayFromBottom(false);
    setUnread(0);
  }, [projectName]);

  // Handle bridge incoming messages — only process messages for the current session
  const handleBridgeMessage = useCallback((msg: BridgeIncoming) => {
    const msgKey = (msg as any).session_key;
    if (msgKey && sessionKeyRef.current && msgKey !== sessionKeyRef.current) {
      return;
    }

    // If a slash command is pending, route the first reply/card to the panel
    const pending = pendingCmdRef.current;
    if (pending && (msg.type === 'reply' || msg.type === 'card' || msg.type === 'buttons')) {
      pendingCmdRef.current = null;
      if (msg.type === 'card') {
        const card = msg as Extract<BridgeIncoming, { type: 'card' }>;
        setCmdResult({ command: pending, content: '', format: 'card', card: card.card });
      } else if (msg.type === 'buttons') {
        const btns = msg as Extract<BridgeIncoming, { type: 'buttons' }>;
        setCmdResult({ command: pending, content: btns.content, format: 'buttons', buttons: btns.buttons });
      } else {
        const reply = msg as Extract<BridgeIncoming, { type: 'reply' }>;
        setCmdResult({ command: pending, content: reply.content, format: 'markdown' });
      }
      setTyping(false);
      return;
    }

    if (msg.type === 'reply') {
      setMessages(prev => {
        const streamIdx = prev.findIndex(m => m.streaming && m.role === 'assistant');
        if (streamIdx >= 0) {
          const updated = [...prev];
          updated[streamIdx] = { ...updated[streamIdx], content: msg.content, format: (msg as any).format === 'markdown' ? 'markdown' : 'text', streaming: false };
          return updated;
        }
        return [...prev, { id: `reply-${Date.now()}`, role: 'assistant', content: msg.content, format: (msg as any).format === 'markdown' ? 'markdown' : 'text', ts: Date.now() }];
      });
      setTyping(false);
    } else if (msg.type === 'reply_stream') {
      const stream = msg as Extract<BridgeIncoming, { type: 'reply_stream' }>;
      if (stream.done) {
        setMessages(prev => {
          const idx = prev.findIndex(m => m.streaming);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = { ...updated[idx], content: stream.full_text, streaming: false };
            return updated;
          }
          return [...prev, { id: `stream-done-${Date.now()}`, role: 'assistant', content: stream.full_text, format: 'markdown', ts: Date.now() }];
        });
        setTyping(false);
      } else {
        setMessages(prev => {
          const idx = prev.findIndex(m => m.streaming);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = { ...updated[idx], content: stream.full_text };
            return updated;
          }
          return [...prev, { id: `stream-${Date.now()}`, role: 'assistant', content: stream.full_text, format: 'markdown', streaming: true, ts: Date.now() }];
        });
      }
    } else if (msg.type === 'card') {
      const card = msg as Extract<BridgeIncoming, { type: 'card' }>;
      setMessages(prev => [...prev, { id: `card-${Date.now()}`, role: 'assistant', content: '', format: 'card', card: card.card, ts: Date.now() }]);
      setTyping(false);
    } else if (msg.type === 'buttons') {
      const btns = msg as Extract<BridgeIncoming, { type: 'buttons' }>;
      setMessages(prev => [...prev, { id: `btn-${Date.now()}`, role: 'assistant', content: btns.content, format: 'buttons', buttons: btns.buttons, ts: Date.now() }]);
      setTyping(false);
    } else if (msg.type === 'typing_start') {
      setTyping(true);
    } else if (msg.type === 'typing_stop') {
      setTyping(false);
    } else if (msg.type === 'preview_start') {
      const ps = msg as Extract<BridgeIncoming, { type: 'preview_start' }>;
      const handle = `web-preview-${++previewHandleCounter.current}`;
      sendPreviewAck(ps.ref_id, handle);
      setMessages(prev => [...prev, { id: `stream-${handle}`, role: 'assistant', content: ps.content, format: 'markdown', streaming: true, ts: Date.now() }]);
    } else if (msg.type === 'update_message') {
      const um = msg as Extract<BridgeIncoming, { type: 'update_message' }>;
      setMessages(prev => {
        const idx = prev.findIndex(m => m.streaming);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], content: um.content };
          return updated;
        }
        return prev;
      });
    } else if (msg.type === 'delete_message') {
      setMessages(prev => {
        const idx = prev.findIndex(m => m.streaming);
        if (idx >= 0) return prev.filter((_, i) => i !== idx);
        return prev;
      });
    }
  }, []);

  const { status: bridgeStatus, sendMessage: bridgeSend, sendCardAction, sendPreviewAck } = useBridgeSocket({
    bridgeCfg,
    sessionKey,
    projectName: projectName || '',
    onMessage: handleBridgeMessage,
  });

  // Follow the stream only while the reader is at the bottom; otherwise count what arrived and
  // offer the jump button instead of yanking the view away.
  const scrollToEnd = useCallback((smooth: boolean) => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    messagesEnd.current?.scrollIntoView({ behavior: smooth && !reduce ? 'smooth' : 'auto', block: 'end' });
  }, []);

  useEffect(() => {
    if (stickRef.current) {
      scrollToEnd(true);
      setUnread(0);
    } else {
      setUnread(n => n + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  useEffect(() => {
    if (stickRef.current) scrollToEnd(true);
  }, [typing, scrollToEnd]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = gap < STICK_SLACK_PX;
    stickRef.current = atBottom;
    setAwayFromBottom(!atBottom);
    if (atBottom) setUnread(0);
  };

  const jumpToLatest = () => {
    stickRef.current = true;
    setAwayFromBottom(false);
    setUnread(0);
    scrollToEnd(true);
  };

  // Composer auto-grows with its content up to the row cap.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    const line = 22;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, line * COMPOSER_MAX_ROWS + 20)}px`;
  }, [input]);

  // Send message
  const handleSend = useCallback(() => {
    if (!input.trim() || bridgeStatus !== 'connected') return;
    const content = input.trim();
    setInput('');
    setSending(true);

    const cmdToken = content.split(' ')[0];
    const isKnownCmd = knownCommands.has(cmdToken);
    if (isKnownCmd && !chatCommands.has(cmdToken)) {
      pendingCmdRef.current = cmdToken;
    } else {
      setMessages(prev => [...prev, { id: `user-${Date.now()}`, role: 'user', content, ts: Date.now() }]);
    }
    bridgeSend(content);
    setTimeout(() => setSending(false), 300);
  }, [input, bridgeStatus, bridgeSend]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === '/' && !input) {
      e.preventDefault();
      setCmdOpen(true);
    }
    if (e.key === 'Escape') {
      setEmojiOpen(false);
    }
  };

  // Commands whose result should go to the message stream (they change state)
  const chatCommands = new Set(['/new', '/stop', '/switch', '/delete-mode', '/upgrade']);
  const knownCommands = new Set(slashCommands.map(c => c.cmd));

  const handleCmdSelect = useCallback((cmd: SlashCommand) => {
    setCmdOpen(false);
    if (bridgeStatus !== 'connected') return;

    if (chatCommands.has(cmd.cmd)) {
      setMessages(prev => [...prev, { id: `user-${Date.now()}`, role: 'user', content: cmd.cmd, ts: Date.now() }]);
    } else {
      pendingCmdRef.current = cmd.cmd;
    }
    bridgeSend(cmd.cmd);
  }, [bridgeStatus, bridgeSend]);

  const handleCardAction = useCallback((value: string) => {
    if (bridgeStatus !== 'connected') return;
    // If the command panel is showing, route the follow-up response back to it
    if (cmdPanelRef.current) {
      pendingCmdRef.current = cmdPanelRef.current;
    }
    sendCardAction(value);
  }, [bridgeStatus, sendCardAction]);

  const handleNewSession = useCallback(() => {
    if (bridgeStatus !== 'connected') return;
    setUserPickedSession(false);
    setMessages(prev => [...prev, { id: `user-${Date.now()}`, role: 'user', content: '/new', ts: Date.now() }]);
    bridgeSend('/new');
    setDrawerOpen(false);
  }, [bridgeStatus, bridgeSend]);

  const insertEmoji = (emoji: string) => {
    setInput(v => v + emoji);
    setEmojiOpen(false);
    composerRef.current?.focus();
  };

  const canSend = bridgeStatus === 'connected';
  const autoSessionLabel = userPickedSession && currentSession
    ? (currentSession.name || currentSession.id.slice(0, 8))
    : t('chat.defaultSession');
  const headerName = shown || projectName || '';
  const peerName = currentSession?.chat_name || currentSession?.name || headerName;
  const selfName = currentSession?.user_name || '我';
  const isThinking = typing && !messages.some(m => m.streaming);

  if (loading && !currentSession && sessions.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-gray-400 animate-pulse">
        Loading…
      </div>
    );
  }

  return (
    <div className="chat-page -m-1 flex min-h-0 flex-1 flex-col sm:-m-2">
      <div className="ch-panel flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header
          className="flex shrink-0 items-center gap-3 px-3 py-2.5 sm:px-4"
          style={{ borderBottom: '1px solid var(--ch-line)' }}
        >
          <Link
            to="/chat"
            className="ch-focus -ml-1 rounded-full p-2 text-[color:var(--ch-ink3)] transition-colors hover:text-[color:var(--ch-ink)]"
            aria-label={copy.listTitle}
          >
            <ArrowLeft size={18} />
          </Link>
          <Avatar name={peerName} size={40} live={bridgeStatus === 'connected'} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="ch-ink truncate text-[15px] font-semibold leading-5">{headerName}</h1>
              <StatusBadge status={bridgeStatus} />
            </div>
            <div className="mt-0.5 flex items-center gap-1.5">
              {isThinking ? (
                <span className="flex items-center gap-1 text-[12px] text-[color:var(--ch-accent-ink)]">
                  <span className="flex gap-[3px]">
                    <span className="ch-dot h-1 w-1 rounded-full bg-current" style={{ animationDelay: '0ms' }} />
                    <span className="ch-dot h-1 w-1 rounded-full bg-current" style={{ animationDelay: '150ms' }} />
                    <span className="ch-dot h-1 w-1 rounded-full bg-current" style={{ animationDelay: '300ms' }} />
                  </span>
                  {copy.thinkingHint}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  className="ch-focus flex items-center gap-1 rounded-full text-[12px] text-[color:var(--ch-ink3)] transition-colors hover:text-[color:var(--ch-accent-ink)]"
                  aria-label={copy.selectChat}
                >
                  {autoSessionLabel}
                  <ChevronDown size={12} />
                </button>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="ch-focus hidden items-center gap-1 rounded-full px-2.5 py-1.5 text-[12px] text-[color:var(--ch-ink3)] transition-colors hover:text-[color:var(--ch-ink)] sm:flex"
            style={{ boxShadow: 'inset 0 0 0 1px var(--ch-line)' }}
          >
            {t('chat.sessions')}
          </button>
        </header>

        {/* Messages */}
        <div className="relative min-h-0 flex-1">
          <div
            ref={scrollRef}
            onScroll={onScroll}
            className="h-full overflow-y-auto px-3 py-4 sm:px-5 sm:py-6"
          >
            {messages.length === 0 && !loading && (
              <div className="flex h-full flex-col items-center justify-center py-12 text-center">
                <Avatar name={peerName} size={56} />
                <p className="ch-ink mt-4 text-[15px] font-medium">{t('chat.emptyHint')}</p>
                <p className="ch-ink3 mt-1 text-[12px]">{t('chat.slashHint')}</p>
              </div>
            )}

            {messages.map((msg, i) => {
              const isUser = msg.role === 'user';
              const prev = messages[i - 1];
              const sameAuthor = !!prev && prev.role === msg.role;
              const newDay = !prev || formatDayLabel(new Date(prev.ts).toISOString(), copy) !== formatDayLabel(new Date(msg.ts).toISOString(), copy);
              const isEmpty = !msg.content && !msg.card && !msg.buttons && !msg.imageUrl && !msg.fileName;
              return (
                <div key={msg.id}>
                  {newDay && (
                    <div className="my-4 flex items-center gap-3">
                      <span className="h-px flex-1" style={{ background: 'var(--ch-line)' }} />
                      <span className="ch-ink3 text-[11px] font-medium">
                        {formatDayLabel(new Date(msg.ts).toISOString(), copy)}
                      </span>
                      <span className="h-px flex-1" style={{ background: 'var(--ch-line)' }} />
                    </div>
                  )}
                  <div
                    className={cn('flex items-end gap-2.5', isUser ? 'justify-end' : 'justify-start', sameAuthor ? 'mt-1' : 'mt-4')}
                  >
                    {!isUser && (
                      <div className={cn('w-8 shrink-0', sameAuthor && 'opacity-0')}>
                        {!sameAuthor && <Avatar name={peerName} size={28} />}
                      </div>
                    )}
                    <div
                      className={cn(
                        'ch-bubble group/msg relative',
                        isUser ? 'ch-bubble-own' : 'ch-bubble-ai',
                        msg.streaming && 'animate-pulse',
                      )}
                    >
                      {isEmpty ? (
                        <p className="text-xs italic text-[color:var(--ch-ink3)]">
                          {t('chat.unsupportedMessage', '[Unsupported message]')}
                        </p>
                      ) : msg.format === 'card' ? (
                        <CardBlock card={msg.card} onAction={handleCardAction} />
                      ) : msg.format === 'buttons' && msg.buttons ? (
                        <ButtonsBlock content={msg.content} buttons={msg.buttons} onAction={handleCardAction} />
                      ) : msg.format === 'image' && msg.imageUrl ? (
                        <ImageBlock url={msg.imageUrl} />
                      ) : msg.format === 'file' && msg.fileName ? (
                        <FileBlock name={msg.fileName} size={msg.fileSize} />
                      ) : isUser ? (
                        <div className="whitespace-pre-wrap">{msg.content}</div>
                      ) : (
                        <RenderMarkdown content={msg.content} />
                      )}
                      {msg.streaming && (
                        <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-accent/60 align-text-bottom" />
                      )}
                      <div className="mt-1 flex items-center justify-end gap-1">
                        <span className="ch-ink3 text-[11px] tabular-nums">{formatClock(new Date(msg.ts).toISOString())}</span>
                      </div>
                      {!isUser && !msg.streaming && msg.content && (
                        <MsgCopyButton text={msg.content} label={copy.copied} />
                      )}
                    </div>
                    {isUser && (
                      <div className={cn('w-8 shrink-0', sameAuthor && 'opacity-0')}>
                        {!sameAuthor && <Avatar name={selfName} size={28} />}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {isThinking && (
              <div className="mt-4 flex items-end gap-2.5">
                <Avatar name={peerName} size={28} />
                <div className="ch-bubble ch-bubble-ai">
                  <div className="flex items-center gap-1.5 py-1">
                    <span className="ch-dot h-1.5 w-1.5 rounded-full bg-[color:var(--ch-ink3)]" style={{ animationDelay: '0ms' }} />
                    <span className="ch-dot h-1.5 w-1.5 rounded-full bg-[color:var(--ch-ink3)]" style={{ animationDelay: '150ms' }} />
                    <span className="ch-dot h-1.5 w-1.5 rounded-full bg-[color:var(--ch-ink3)]" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEnd} />
          </div>

          {/* Jump to latest */}
          {awayFromBottom && (
            <button
              type="button"
              onClick={jumpToLatest}
              className="ch-focus ch-enter absolute bottom-4 right-4 flex items-center gap-1.5 rounded-full px-3 py-2 text-[12px] font-medium"
              style={{ background: 'var(--ch-panel)', boxShadow: 'var(--ch-e2)', color: 'var(--ch-ink)' }}
              aria-label={copy.scrollLatest}
            >
              <ArrowDown size={14} className="text-[color:var(--ch-accent-ink)]" />
              {unread > 0 ? copy.newMessages(unread) : copy.backToLatest}
            </button>
          )}
        </div>

        {/* Composer */}
        <div className="shrink-0 px-3 pb-3 pt-2 sm:px-4">
          {canSend ? (
            <div
              className="relative flex items-end gap-1.5 rounded-[20px] p-1.5"
              style={{ background: 'var(--ch-sub)', boxShadow: 'inset 0 0 0 1px var(--ch-edge)' }}
            >
              <div className="relative">
                <button
                  ref={cmdBtnRef}
                  type="button"
                  onClick={() => setCmdOpen(!cmdOpen)}
                  className={cn(
                    'ch-focus flex h-9 w-9 items-center justify-center rounded-full transition-colors',
                    cmdOpen ? 'text-[color:var(--ch-accent-ink)]' : 'text-[color:var(--ch-ink3)] hover:text-[color:var(--ch-ink)]',
                  )}
                  style={cmdOpen ? { background: 'var(--ch-own)' } : undefined}
                  title={t('chat.commands')}
                  aria-label={t('chat.commands')}
                >
                  <Slash size={18} />
                </button>
                <CommandPalette
                  open={cmdOpen}
                  onClose={() => setCmdOpen(false)}
                  onSelect={handleCmdSelect}
                  anchorRef={cmdBtnRef}
                />
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setEmojiOpen(v => !v)}
                  className={cn(
                    'ch-focus flex h-9 w-9 items-center justify-center rounded-full transition-colors',
                    emojiOpen ? 'text-[color:var(--ch-accent-ink)]' : 'text-[color:var(--ch-ink3)] hover:text-[color:var(--ch-ink)]',
                  )}
                  style={emojiOpen ? { background: 'var(--ch-own)' } : undefined}
                  title={copy.emoji}
                  aria-label={copy.emoji}
                >
                  <Smile size={18} />
                </button>
                {emojiOpen && (
                  <div
                    className="ch-enter absolute bottom-full left-0 z-50 mb-2 grid w-[248px] grid-cols-8 gap-1 rounded-[16px] p-2"
                    style={{ background: 'var(--ch-panel)', boxShadow: 'var(--ch-e3)', border: '1px solid var(--ch-line)' }}
                  >
                    {EMOJI.map(e => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => insertEmoji(e)}
                        className="ch-focus flex h-6 w-6 items-center justify-center rounded-md text-[16px] leading-none transition-colors hover:bg-[var(--ch-hover)]"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => composerRef.current?.focus()}
                className="ch-focus flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[color:var(--ch-ink3)] transition-colors hover:text-[color:var(--ch-ink)]"
                title={copy.attachHint}
                aria-label={copy.attachHint}
              >
                <Plus size={18} />
              </button>

              <textarea
                ref={composerRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('chat.inputPlaceholder')}
                rows={1}
                aria-label={t('chat.inputPlaceholder')}
                className="max-h-[152px] min-h-[36px] flex-1 resize-none bg-transparent px-1 py-2 text-[14px] leading-[22px] text-[color:var(--ch-ink)] outline-none placeholder:text-[color:var(--ch-ink3)]"
              />

              <button
                type="button"
                onClick={handleSend}
                disabled={sending || !input.trim()}
                className="ch-focus mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-black transition-[filter,transform] hover:brightness-[1.04] active:translate-y-px disabled:opacity-40"
                style={{ background: 'var(--ch-accent)' }}
                aria-label={copy.startChat}
              >
                {sending ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
              </button>
            </div>
          ) : !bridgeCfg ? (
            <div className="flex items-center gap-2 rounded-[16px] bg-amber-500/10 px-4 py-3 text-[13px] text-amber-700 dark:text-amber-400">
              <WifiOff size={14} />
              <span>{t('sessions.bridgeNotAvailable')}</span>
            </div>
          ) : bridgeStatus === 'disconnected' || bridgeStatus === 'error' ? (
            <div className="flex items-center gap-2 rounded-[16px] bg-amber-500/10 px-4 py-3 text-[13px] text-amber-700 dark:text-amber-400">
              <WifiOff size={14} />
              <span>{t('sessions.bridgeDisconnected')}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-[16px] px-4 py-3 text-[13px] text-[color:var(--ch-ink3)]" style={{ background: 'var(--ch-sub)' }}>
              <Loader2 size={14} className="animate-spin" />
              <span>{t('sessions.bridgeConnecting')}</span>
            </div>
          )}
        </div>
      </div>

      {/* Session drawer */}
      <SessionDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        sessions={sessions}
        currentSessionId={currentSession?.id || ''}
        onSelect={switchToSession}
        onNewSession={handleNewSession}
      />

      {/* Command result panel */}
      <CommandResultPanel
        result={cmdResult}
        onClose={() => setCmdResult(null)}
        onCardAction={handleCardAction}
      />
    </div>
  );
}
