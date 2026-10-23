import { useState } from 'react';
import { Check, Copy, Eye, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import { deleteItem, MINE_PACK, resetItem, undoItem, type ApplyResult, type Library, type LibraryKind, type LibraryPersona } from '@/api/library';
import { fmt, type LibraryTexts } from '@/pages/Setup/texts';
import { cn } from '@/lib/utils';
import { LibraryAvatar } from './LibraryAvatar';
import { PersonaEditor, type PersonaDraft } from './PersonaEditor';

/** The last delete / hide, kept until the next action so it can be undone. */
export interface UndoNote { kind: LibraryKind; slug: string; text: string }

export const packLabel = (lib: Library, id: string, T: LibraryTexts) =>
  id === MINE_PACK ? T.mine : lib.packs.find((p) => p.id === id)?.name || id;

/** Bottom notice with Undo (delete / hide) or the roles a persona edit reached. */
export function Notice({ note, onUndo, onClose, T }: { note: { text: string; undo?: boolean } | null; onUndo: () => void; onClose: () => void; T: LibraryTexts }) {
  if (!note) return null;
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-900 text-white text-sm dark:bg-white dark:text-gray-900" role="status" data-testid="lib-notice">
      <span className="flex-1">{note.text}</span>
      {note.undo && <button type="button" className="font-semibold underline" onClick={onUndo} data-testid="lib-undo">{T.undo}</button>}
      <button type="button" className="opacity-60" onClick={onClose} aria-label={T.close}>×</button>
    </div>
  );
}

/** Ask, then delete (only in "mine") or hide (other packs); the notice offers Undo. */
export async function removeWithUndo(lang: string, kind: LibraryKind, slug: string, name: string, pack: string, own: boolean, T: LibraryTexts): Promise<UndoNote | null> {
  if (!window.confirm(own ? fmt(T.removeConfirm, { name }) : fmt(T.hideConfirm, { name, pack }))) return null;
  const r = await deleteItem(lang, kind, slug);
  return { kind, slug, text: fmt(r.result === 'hidden' ? T.hidden : T.removed, { name }) };
}

export const appliedText = (r: ApplyResult, T: LibraryTexts) =>
  [r.applied?.length ? fmt(T.applied, { roles: r.applied.join('、') }) : '', r.skipped?.length ? fmt(T.skipped, { roles: r.skipped.join('、') }) : '']
    .filter(Boolean).join('；');

/** Persona card grid: new / edit / copy / delete with undo; built-ins only hide and come back.
 *  With onPick it is also the wizard's picker (selected = the slug in use). */
export function PersonaLibrary({ lib, lang, T, reload, selected, onPick }: {
  lib: Library; lang: string; T: LibraryTexts; reload: () => void;
  selected?: string; onPick?: (p: LibraryPersona | null) => void;
}) {
  const [showHidden, setShowHidden] = useState(false);
  const [draft, setDraft] = useState<PersonaDraft | null>(null);
  const [note, setNote] = useState<{ text: string; undo?: UndoNote } | null>(null);
  const [error, setError] = useState('');
  const avatarURL = (slug?: string) => (slug ? lib.avatars.find((a) => a.slug === slug)?.url : undefined);
  const list = lib.personas.filter((p) => showHidden || !p.hidden);
  const hiddenCount = lib.personas.filter((p) => p.hidden).length;

  const run = async (fn: () => Promise<void>) => { setError(''); try { await fn(); } catch (e: any) { setError(e?.message || String(e)); } };
  const remove = (p: LibraryPersona) => run(async () => {
    const own = p.pack === MINE_PACK && !p.overrides;
    const u = await removeWithUndo(lang, 'personas', p.slug, p.name, packLabel(lib, p.pack, T), own, T);
    if (u) { setNote({ text: u.text, undo: u }); reload(); }
  });
  const undo = () => run(async () => {
    if (!note?.undo) return;
    const r = await undoItem(lang, note.undo.kind, note.undo.slug);
    setNote({ text: [T.undone, appliedText(r, T)].filter(Boolean).join('：') }); reload();
  });
  const show = (p: LibraryPersona) => run(async () => { await undoItem(lang, 'personas', p.slug); reload(); });
  const reset = (p: LibraryPersona) => run(async () => {
    const r = await resetItem(lang, 'personas', p.slug);
    setNote({ text: appliedText(r, T) || T.reset, undo: { kind: 'personas', slug: p.slug, text: '' } }); reload();
  });

  return (
    <div className="space-y-3" data-testid="persona-library">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setDraft({ name: '', intro: '', avatar: '', text: '' })} data-testid="persona-new"><Plus size={14} />{T.newPersona}</Button>
        {hiddenCount > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-gray-500">
            <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} data-testid="persona-show-hidden" />
            {T.showHidden} ({hiddenCount})
          </label>
        )}
      </div>
      <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {onPick && (
          <button type="button" onClick={() => onPick(null)} data-testid="persona-card-none"
            className={cn('text-left p-3 rounded-xl border text-sm text-gray-500 transition-colors',
              !selected ? 'border-accent ring-2 ring-accent/30' : 'border-dashed border-gray-300 dark:border-gray-700 hover:border-accent/60')}>
            {T.none}
          </button>
        )}
        {list.map((p) => {
          const picked = selected === p.slug;
          return (
            <div key={p.slug} data-testid={`persona-card-${p.slug}`}
              className={cn('group flex flex-col gap-2 p-3 rounded-xl border bg-white/70 dark:bg-white/[0.03] transition-colors',
                picked ? 'border-accent ring-2 ring-accent/30' : 'border-gray-200 dark:border-gray-700', p.hidden && 'opacity-50')}>
              <div className="flex items-start gap-3">
                <LibraryAvatar url={avatarURL(p.avatar)} name={p.name} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1 font-medium text-sm text-gray-900 dark:text-white">
                    <span className="truncate">{p.name}</span>
                    {p.overrides && <Badge variant="info">{T.editedTag}</Badge>}
                    {p.hidden && <Badge>{T.hiddenTag}</Badge>}
                  </div>
                  <p className="text-xs text-gray-500 line-clamp-2">{p.intro}</p>
                  <p className="text-[11px] text-gray-400">{fmt(T.packTag, { pack: packLabel(lib, p.pack, T) })}{p.in_use?.length ? ` · ${T.inUse}${p.in_use.join('、')}` : ''}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1 mt-auto">
                {onPick && !p.hidden && (
                  <Button size="sm" variant={picked ? 'primary' : 'secondary'} onClick={() => onPick(p)} data-testid={`persona-pick-${p.slug}`}>
                    {picked && <Check size={14} />}{picked ? T.picked : T.pick}
                  </Button>
                )}
                {p.hidden
                  ? <Button size="sm" variant="ghost" onClick={() => show(p)} data-testid={`persona-show-${p.slug}`}><Eye size={14} />{T.show}</Button>
                  : <>
                      <Button size="sm" variant="ghost" title={T.edit} onClick={() => setDraft({ slug: p.slug, name: p.name, intro: p.intro, avatar: p.avatar || '', text: p.text })} data-testid={`persona-edit-${p.slug}`}><Pencil size={14} /></Button>
                      <Button size="sm" variant="ghost" title={T.copy} onClick={() => setDraft({ name: fmt(T.copyOf, { name: p.name }), intro: p.intro, avatar: p.avatar || '', text: p.text })} data-testid={`persona-copy-${p.slug}`}><Copy size={14} /></Button>
                      {p.overrides && <Button size="sm" variant="ghost" title={T.reset} onClick={() => reset(p)} data-testid={`persona-reset-${p.slug}`}><RotateCcw size={14} /></Button>}
                      <Button size="sm" variant="ghost" title={p.pack === MINE_PACK && !p.overrides ? T.remove : T.hide} onClick={() => remove(p)} data-testid={`persona-remove-${p.slug}`}><Trash2 size={14} /></Button>
                    </>}
              </div>
            </div>
          );
        })}
      </div>
      {error && <p className="text-sm text-red-500" role="alert">{error}</p>}
      <Notice note={note && { text: note.text, undo: !!note.undo }} onUndo={undo} onClose={() => setNote(null)} T={T} />
      <PersonaEditor draft={draft} lib={lib} lang={lang} T={T} onClose={() => setDraft(null)} reload={reload}
        onSaved={(p, r) => { setNote(appliedText(r, T) ? { text: appliedText(r, T) } : null); reload(); if (onPick && !draft?.slug) onPick({ ...p, avatar: p.avatar }); }} />
    </div>
  );
}
