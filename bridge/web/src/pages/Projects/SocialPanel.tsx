import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquare, RefreshCw, Trash2, Upload, UserRound } from 'lucide-react';
import { Button, Card, EmptyState, LoadingState, Textarea } from '@/components/ui';
import {
  deleteMoment,
  getSocial,
  postMoment,
  setAvatar,
  type Moment,
  type SocialState,
} from '@/api/social';
import { socialTexts } from '@/pages/Social/texts';

/**
 * QQ 说说与头像 (#150 第 c 项), as a role's tab.
 *
 * Everything on this tab acts as the QQ account itself: a 说说 is visible to other
 * people, a new avatar is visible everywhere. So the backend keeps both behind
 * allow_qzone / allow_avatar, and this panel shows what is on instead of offering a
 * button that answers 403. Nothing here posts on a timer — that is the cron page's
 * job, and it stays a separate decision.
 */
export default function SocialPanel({ project }: { project: string }) {
  const { i18n } = useTranslation();
  const T = socialTexts(i18n.language || 'en');
  const [state, setState] = useState<SocialState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [failed, setFailed] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [picked, setPicked] = useState<File | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setState(await getSocial(project));
      setError('');
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    fetchData();
    const handler = () => fetchData();
    window.addEventListener('cc:refresh', handler);
    return () => window.removeEventListener('cc:refresh', handler);
  }, [fetchData]);

  const post = async () => {
    const want = text.trim();
    if (!want) return;
    // Publishing is one-way: ask once, outside the panel's own copy.
    if (!confirm(`${T.post}？\n\n${T.postNote}`)) return;
    setBusy('post');
    setFailed('');
    setNote('');
    try {
      await postMoment(project, want);
      setText('');
      setNote(T.posted);
      await fetchData();
    } catch (e: any) {
      setFailed(T.failed(e?.message || String(e)));
    } finally {
      setBusy('');
    }
  };

  const remove = async (m: Moment) => {
    if (!confirm(T.deleteConfirm)) return;
    setBusy(`del-${m.id}`);
    setFailed('');
    setNote('');
    try {
      await deleteMoment(project, m.id);
      setNote(T.deleted);
      await fetchData();
    } catch (e: any) {
      setFailed(T.failed(e?.message || String(e)));
    } finally {
      setBusy('');
    }
  };

  const changeAvatar = async () => {
    if (!picked) return;
    if (!confirm(`${T.avatarChange}？\n\n${T.avatarConfirm}`)) return;
    setBusy('avatar');
    setFailed('');
    setNote('');
    try {
      await setAvatar(project, picked);
      setPicked(null);
      if (fileRef.current) fileRef.current.value = '';
      setNote(T.avatarChanged);
    } catch (e: any) {
      setFailed(T.failed(e?.message || String(e)));
    } finally {
      setBusy('');
    }
  };

  if (loading && !state) return <LoadingState />;

  const caps = state?.capabilities;
  const canPost = !!caps?.post_moment;
  const canRemove = !!caps?.remove_moment;
  const canAvatar = !!caps?.set_avatar;

  return (
    <div className="space-y-4">
      {state?.status === 'not_supported' && (
        <Card>
          <div data-testid="social-unsupported">
            <p className="text-sm font-semibold text-ink">{T.unsupported}</p>
            <p className="mt-1 text-[13px] text-ink-soft">{T.unsupportedHint}</p>
            {state.message && <p className="mt-2 text-[12px] text-ink-mute">{state.message}</p>}
          </div>
        </Card>
      )}

      {state && state.status !== 'not_supported' && (!canPost || !canAvatar) && (
        <Card>
          <div data-testid="social-off">
            <p className="text-sm font-semibold text-ink">{T.off}</p>
            <p className="mt-1 text-[13px] text-ink-soft">{T.offHint}</p>
            {caps?.disabled_reason && (
              <p className="mt-2 text-[12px] text-ink-mute" data-testid="social-off-reason">
                {caps.disabled_reason}
              </p>
            )}
          </div>
        </Card>
      )}

      {error && (
        <Card>
          <p className="text-sm text-red-500" data-testid="social-error">{error}</p>
        </Card>
      )}

      {state && state.status === 'error' && (
        <Card>
          <p className="text-sm font-semibold text-ink">{T.errorTitle}</p>
          {state.message && <p className="mt-1 text-[13px] text-ink-soft">{state.message}</p>}
        </Card>
      )}

      {note && <p className="text-[13px] text-emerald-600 dark:text-emerald-400" data-testid="social-note">{note}</p>}
      {failed && <p className="text-[13px] text-red-500" data-testid="social-failed">{failed}</p>}

      {state && state.status !== 'not_supported' && (
        <>
          <Card>
            <label className="block text-xs font-medium text-ink-soft mb-1">{T.postLabel}</label>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={T.postPlaceholder}
              rows={3}
              data-testid="social-text"
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-[12px] text-ink-mute">{T.postNote}</p>
              <Button onClick={post} disabled={!canPost || busy !== '' || !text.trim()} data-testid="social-post">
                <MessageSquare size={14} />
                {busy === 'post' ? T.posting : T.post}
              </Button>
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-ink">{T.listTitle}</h3>
              <Button variant="secondary" onClick={fetchData} disabled={busy !== ''} data-testid="social-refresh">
                <RefreshCw size={14} />
                {T.refresh}
              </Button>
            </div>
            <div className="mt-3 space-y-3" data-testid="social-list">
              {state.moments.length === 0 ? (
                <EmptyState message={T.empty} hint={T.emptyHint} />
              ) : (
                state.moments.map((m) => (
                  <div
                    key={m.id || m.text}
                    className="rounded-lg border border-hairline p-3"
                    data-testid={`social-moment-${m.id}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="whitespace-pre-wrap break-words text-sm text-ink">{m.text}</p>
                        <p className="mt-1 text-[12px] text-ink-mute">
                          {m.time && m.time !== '0001-01-01T00:00:00Z' ? new Date(m.time).toLocaleString() : ''}
                          {m.private && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">{T.privateLabel}</span>}
                        </p>
                      </div>
                      <Button
                        variant="secondary"
                        onClick={() => remove(m)}
                        disabled={!canRemove || !m.id || busy !== ''}
                        data-testid={`social-delete-${m.id}`}
                      >
                        <Trash2 size={14} />
                        {busy === `del-${m.id}` ? T.deleting : T.delete}
                      </Button>
                    </div>
                    {m.images.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {m.images.map((src) => (
                          <img
                            key={src}
                            src={src}
                            alt=""
                            className="h-16 w-16 rounded object-cover border border-hairline"
                            referrerPolicy="no-referrer"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card>
            <h3 className="text-sm font-semibold text-ink">{T.avatarTitle}</h3>
            <p className="mt-1 text-[13px] text-ink-soft">{T.avatarHint}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg"
                className="text-[13px] text-ink-soft"
                data-testid="social-avatar-input"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  if (f && f.size > 2 * 1024 * 1024) {
                    setPicked(null);
                    setFailed(T.avatarTooBig);
                    e.target.value = '';
                    return;
                  }
                  setFailed('');
                  setPicked(f);
                }}
              />
              <Button
                onClick={changeAvatar}
                disabled={!canAvatar || !picked || busy !== ''}
                data-testid="social-avatar-submit"
              >
                {busy === 'avatar' ? <Upload size={14} /> : <UserRound size={14} />}
                {busy === 'avatar' ? T.avatarChanging : T.avatarChange}
              </Button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
