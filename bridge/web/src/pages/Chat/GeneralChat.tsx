import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowLeft, Hash, Send } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ApiError } from '@/api/client';
import {
  listGeneralMembers, listGeneralMessages, postGeneralMessage, subscribeGeneralMessages,
  type GeneralMember, type GeneralMessage,
} from '@/api/general';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import GeneralMembership from './GeneralMembership';

type RoomStatus = 'loading' | 'unavailable' | 'loadError' | 'connecting' | 'live' | 'reconnecting' | 'disconnected';

function insertMessage(messages: GeneralMessage[], message: GeneralMessage): GeneralMessage[] {
  const index = messages.findIndex((saved) => Number(saved.id) >= Number(message.id));
  if (index === -1) return [...messages, message];
  if (messages[index].id === message.id) return messages;
  return [...messages.slice(0, index), message, ...messages.slice(index)];
}

export default function GeneralChat() {
  const { t, i18n } = useTranslation();
  const [members, setMembers] = useState<GeneralMember[]>([]);
  const [messages, setMessages] = useState<GeneralMessage[]>([]);
  const [status, setStatus] = useState<RoomStatus>('loading');
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const followMessages = useRef(true);
  const roomReady = status === 'connecting' || status === 'live' || status === 'reconnecting' || status === 'disconnected';
  const retryable = status === 'loadError' || status === 'disconnected';
  const dateFormat = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    async function load() {
      try {
        const [{ members }, { messages }] = await Promise.all([listGeneralMembers(), listGeneralMessages()]);
        if (!active) return;
        setMembers(members);
        setMessages(messages);
        setStatus('connecting');
        const cursor = messages[messages.length - 1]?.id ?? '0';
        unsubscribe = subscribeGeneralMessages(cursor, {
          open: () => setStatus('live'),
          message: (message) => setMessages((saved) => insertMessage(saved, message)),
          disconnect: (willReconnect) => setStatus(willReconnect ? 'reconnecting' : 'disconnected'),
        });
      } catch (error) {
        if (!active) return;
        setStatus(error instanceof ApiError && error.status === 404 ? 'unavailable' : 'loadError');
      }
    }

    void load();
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [attempt]);

  useEffect(() => {
    const pane = transcript.current;
    if (!pane) return;
    const follow = () => {
      if (followMessages.current) pane.scrollTop = pane.scrollHeight;
    };
    follow();
    window.addEventListener('resize', follow);
    return () => window.removeEventListener('resize', follow);
  }, [messages]);

  function reloadRoom() {
    setStatus('loading');
    setAttempt((value) => value + 1);
  }

  function mention(project: string) {
    setDraft((current) => {
      const text = current.trimStart();
      // Replace a leading room mention, including project names with spaces.
      const addressed = members.filter(({ project: name }) => {
        const prefix = `@${name}`;
        return text.startsWith(prefix) && (text.length === prefix.length || /[\s,，:：]/u.test(text[prefix.length]));
      }).sort((a, b) => b.project.length - a.project.length)[0];
      const content = addressed ? text.slice(addressed.project.length + 1).replace(/^[\s,，:：]+/u, '') : text;
      return `@${project} ${content}`;
    });
    composer.current?.focus();
  }

  async function send() {
    if (sending || !roomReady || !draft.trim()) return;
    setSending(true);
    setSendError(false);
    try {
      const message = await postGeneralMessage(draft);
      followMessages.current = true;
      setMessages((saved) => insertMessage(saved, message));
      const pane = transcript.current;
      if (pane) pane.scrollTop = pane.scrollHeight;
      setDraft('');
    } catch {
      setSendError(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="mx-auto flex h-[calc(100dvh-9rem)] min-h-80 w-full max-w-4xl flex-col overflow-hidden rounded-card bg-surface shadow-ui-1" aria-labelledby="general-title">
      <header className="shrink-0 border-b border-hairline px-3 py-3 sm:px-5">
        <div className="flex items-center gap-3">
          <Link to="/chat" aria-label={t('common.back')} className="grid h-9 w-9 shrink-0 place-items-center rounded-control text-ink-mute hover:bg-surface-sunken hover:text-ink">
            <ArrowLeft size={18} />
          </Link>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-accent-wash text-accent-text"><Hash size={20} /></span>
          <div className="min-w-0 flex-1">
            <h1 id="general-title" className="text-base font-semibold tracking-tight text-ink">{t('general.title')}</h1>
            <p className="text-xs text-ink-mute" role="status">{t(`general.status.${status}`)}</p>
          </div>
          {retryable && (
            <Button type="button" variant="secondary" size="sm" disabled={sending} onClick={reloadRoom}>
              {t('common.retry')}
            </Button>
          )}
        </div>
        {roomReady && (
          <div className="mt-3 flex min-w-0 items-center gap-2 text-xs text-ink-soft">
            <span className="shrink-0 font-medium">{t('general.members')}</span>
            {members.length === 0 ? <span className="text-ink-mute">{t('general.noMembers')}</span> : (
              <ul className="flex min-w-0 items-center gap-1.5 overflow-x-auto px-1 py-1">
                {members.map((member) => (
                  <li key={member.project} className="shrink-0">
                    <Button type="button" variant="ghost" size="sm" className="border border-hairline bg-canvas"
                      disabled={sending} onClick={() => mention(member.project)}>
                      {member.display_name !== member.project && <span>{member.display_name}</span>}
                      <span className="text-ink-mute">@{member.project}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <GeneralMembership members={members} onRefresh={reloadRoom} />
      </header>

      <div ref={transcript} className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-canvas/60 p-4 sm:px-6"
        role="log" aria-labelledby="general-title" aria-busy={status === 'loading'} tabIndex={0}
        onScroll={({ currentTarget: pane }) => { followMessages.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 48; }}>
        {status === 'unavailable' && <p className="py-6 text-center text-sm text-ink-soft">{t('general.enableHint')}</p>}
        {roomReady && messages.length === 0 && <p className="py-6 text-center text-sm text-ink-mute">{t('chat.noMessages')}</p>}
        <ol className="space-y-4">
          {messages.map((message) => (
            <li key={message.id} className={cn('flex flex-col gap-1', message.kind === 'user' ? 'items-end' : 'items-start')}>
              <div className="flex max-w-full flex-wrap items-baseline gap-x-2 px-1 text-xs text-ink-mute [overflow-wrap:anywhere]">
                <span className="font-semibold text-ink-soft">{message.author}</span>
                {message.kind !== 'user' && message.author_id !== message.author && <span>@{message.author_id}</span>}
                <time dateTime={message.created_at}>{dateFormat.format(new Date(message.created_at))}</time>
              </div>
              <div className={cn('min-w-0 max-w-[92%] rounded-card px-3.5 py-2.5 text-sm text-ink [overflow-wrap:anywhere] sm:max-w-[86%]',
                message.kind === 'user' ? 'rounded-br-sm bg-accent-wash' : 'rounded-bl-sm bg-surface shadow-ui-1')}>
                {message.kind === 'agent' ? (
                  <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-pre:overflow-x-auto">
                    <Markdown remarkPlugins={[remarkGfm]}>{message.text}</Markdown>
                  </div>
                ) : <p className="whitespace-pre-wrap">{message.text}</p>}
              </div>
            </li>
          ))}
        </ol>
      </div>

      {roomReady && (
        <form className="shrink-0 border-t border-hairline p-3 sm:px-5" onSubmit={(event) => { event.preventDefault(); void send(); }}>
          <div className="flex items-end gap-2 rounded-card border border-hairline p-2 focus-within:border-accent-text">
            <textarea ref={composer} value={draft} onChange={(event) => setDraft(event.target.value)} readOnly={sending}
              aria-label={t('general.compose')} placeholder={t('general.compose')} rows={2}
              className="min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-ink outline-none placeholder:text-ink-mute"
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
                event.preventDefault();
                void send();
              }} />
            <Button type="submit" disabled={!draft.trim()} loading={sending} className="h-9 w-9 shrink-0 px-0" aria-label={t('general.send')}>
              {!sending && <Send size={16} />}
            </Button>
          </div>
          {sendError && <p className="mt-2 text-xs text-red-700 dark:text-red-400" role="alert">{t('general.sendError')}</p>}
        </form>
      )}
    </section>
  );
}
