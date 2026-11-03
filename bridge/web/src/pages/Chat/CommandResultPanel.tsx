import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { slashCommands } from './CommandPalette';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

interface CommandResult {
  command: string;
  content: string;
  format: 'text' | 'markdown' | 'card' | 'buttons';
  card?: any;
  buttons?: { text: string; data: string }[][];
}

interface Props {
  result: CommandResult | null;
  onClose: () => void;
  onCardAction?: (value: string) => void;
}

/** Parse "**command** description" into { cmd, desc }. */
function parseListItemText(text: string): { cmd: string; desc: string } {
  const m = text.match(/^\*\*(.+?)\*\*\s*(.*)/);
  if (m) return { cmd: m[1], desc: m[2] };
  const sp = text.indexOf(' ');
  if (sp > 0) return { cmd: text.slice(0, sp), desc: text.slice(sp + 1) };
  return { cmd: text, desc: '' };
}

/** Renders simple inline bold (**text**) without a full markdown parser. */
function InlineMd({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**')
          ? <strong key={i} className="font-semibold text-[color:var(--ch-ink)]">{p.slice(2, -2)}</strong>
          : <span key={i}>{p}</span>
      )}
    </>
  );
}

function Prose({ children }: { children: string }) {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1.5 prose-p:leading-relaxed prose-headings:mt-3 prose-headings:mb-1.5 prose-headings:font-semibold prose-li:my-0.5 prose-ul:my-1 prose-ol:my-1 prose-a:text-accent prose-a:no-underline hover:prose-a:underline prose-strong:font-semibold prose-code:text-[0.85em] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:bg-[var(--ch-sub)] prose-code:font-mono prose-blockquote:border-l-2 prose-blockquote:border-[color:var(--ch-edge)] prose-blockquote:pl-3 prose-blockquote:not-italic prose-blockquote:text-[color:var(--ch-ink2)]">
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {children}
      </Markdown>
    </div>
  );
}

function CardContent({ card, onAction }: { card: any; onAction?: (v: string) => void }) {
  if (!card) return null;
  return (
    <div className="space-y-4">
      {card.header?.title && (
        <h3 className="text-base font-semibold text-[color:var(--ch-ink)]">
          {card.header.title}
        </h3>
      )}
      {card.elements?.map((el: any, i: number) => (
        <ElementRenderer key={i} el={el} onAction={onAction} />
      ))}
    </div>
  );
}

function ElementRenderer({ el, onAction }: { el: any; onAction?: (v: string) => void }) {
  if (el.type === 'markdown') {
    return <Prose>{el.content}</Prose>;
  }

  if (el.type === 'divider') {
    return <div className="border-t border-[color:var(--ch-line)]" />;
  }

  if (el.type === 'note') {
    return (
      <p className="text-[11px] text-[color:var(--ch-ink3)] leading-relaxed">
        {el.text}
      </p>
    );
  }

  if (el.type === 'actions') {
    return (
      <div className="flex flex-wrap gap-2">
        {el.buttons?.map((btn: any, j: number) => (
          <button
            key={j}
            onClick={() => onAction?.(btn.value)}
            className={cn(
              'px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-150',
              btn.btn_type === 'primary'
                ? 'bg-accent text-black hover:bg-accent-dim shadow-sm'
                : btn.btn_type === 'danger'
                ? 'bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20'
                : 'bg-[var(--ch-sub)] text-[color:var(--ch-ink2)] hover:bg-[var(--ch-hover)]',
            )}
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
      <button
        onClick={() => onAction?.(el.btn_value)}
        className="w-full flex items-center gap-3 py-2.5 px-3 -mx-3 rounded-xl hover:bg-[var(--ch-hover)] transition-colors text-left group"
      >
        {isCommand ? (
          <>
            <code className="shrink-0 w-24 text-xs font-mono font-medium text-accent">{parsed.cmd}</code>
            <span className="flex-1 text-sm text-[color:var(--ch-ink2)] truncate">{parsed.desc}</span>
          </>
        ) : (
          <span className="flex-1 text-sm text-[color:var(--ch-ink2)] truncate min-w-0">
            <InlineMd text={el.text} />
          </span>
        )}
        <span className={cn(
          'shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all',
          el.btn_type === 'primary'
            ? 'bg-accent/15 text-accent group-hover:bg-accent/25'
            : 'text-[color:var(--ch-ink3)] bg-[var(--ch-sub)] group-hover:bg-accent/15 group-hover:text-accent',
        )}>
          {el.btn_text}
        </span>
      </button>
    );
  }

  if (el.type === 'select') {
    return (
      <select
        defaultValue={el.init_value}
        onChange={(e) => onAction?.(e.target.value)}
        className="w-full px-3 py-2 text-sm rounded-lg border border-[color:var(--ch-edge)] bg-white dark:bg-gray-800/80 text-[color:var(--ch-ink)] focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
      >
        {el.options?.map((opt: any, j: number) => (
          <option key={j} value={opt.value}>{opt.text}</option>
        ))}
      </select>
    );
  }

  return null;
}

export default function CommandResultPanel({ result, onClose, onCardAction }: Props) {
  const { t } = useTranslation();

  if (!result) return null;

  const cmdDef = slashCommands.find(c => c.cmd === result.command);
  const Icon = cmdDef?.icon;
  const label = cmdDef ? t(cmdDef.labelKey) : result.command;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/20 transition-opacity dark:bg-black/50"
        onClick={onClose}
      />

      <div className={cn(
        'chat-page fixed right-0 top-0 z-50 flex h-full w-[400px] max-w-[90vw] flex-col',
        'translate-x-0 transition-transform duration-300 ease-out',
      )}
        style={{
          background: 'var(--ch-panel)',
          borderLeft: '1px solid var(--ch-line)',
          boxShadow: 'var(--ch-e3)',
          color: 'var(--ch-ink)',
        }}
      >
        {/* Header */}
        <div className="flex h-14 shrink-0 items-center justify-between px-5" style={{ borderBottom: '1px solid var(--ch-line)' }}>
          <div className="flex items-center gap-2.5 min-w-0">
            {Icon && (
              <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                <Icon size={14} className="text-accent" />
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate text-[14px] font-medium text-[color:var(--ch-ink)]">{label}</div>
              <div className="font-mono text-[10px] text-[color:var(--ch-ink3)]">{result.command}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ch-focus flex h-9 w-9 items-center justify-center rounded-full text-[color:var(--ch-ink3)] transition-colors hover:text-[color:var(--ch-ink)]"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {result.format === 'card' && result.card ? (
            <CardContent card={result.card} onAction={onCardAction} />
          ) : result.format === 'buttons' && result.buttons ? (
            <div className="space-y-4">
              {result.content && <Prose>{result.content}</Prose>}
              {result.buttons.map((row, i) => (
                <div key={i} className="flex flex-wrap gap-2">
                  {row.map((btn, j) => (
                    <button
                      key={j}
                      onClick={() => onCardAction?.(btn.data)}
                      className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-accent text-black hover:bg-accent-dim shadow-sm transition-all duration-150"
                    >
                      {btn.text}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <Prose>{result.content}</Prose>
          )}
        </div>
      </div>
    </>
  );
}

export type { CommandResult };
