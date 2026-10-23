import { useState } from 'react';
import { Eye, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import { MINE_PACK, resetItem, undoItem, type Library, type LibraryAvatar as Item } from '@/api/library';
import { fmt, type LibraryTexts } from '@/pages/Setup/texts';
import { cn } from '@/lib/utils';
import { LibraryAvatar } from './LibraryAvatar';
import { AvatarUpload } from './AvatarUpload';
import { Notice, packLabel, removeWithUndo, type UndoNote } from './PersonaLibrary';

/** Avatar grid: upload (drag or pick, cropped square), delete with undo, built-ins hide and come back. */
export function AvatarLibrary({ lib, lang, T, reload }: { lib: Library; lang: string; T: LibraryTexts; reload: () => void }) {
  const [upload, setUpload] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [note, setNote] = useState<{ text: string; undo?: UndoNote } | null>(null);
  const [error, setError] = useState('');
  const list = lib.avatars.filter((a) => showHidden || !a.hidden);
  const hiddenCount = lib.avatars.filter((a) => a.hidden).length;
  const run = async (fn: () => Promise<void>) => { setError(''); try { await fn(); } catch (e: any) { setError(e?.message || String(e)); } };
  const remove = (a: Item) => run(async () => {
    const u = await removeWithUndo(lang, 'avatars', a.slug, a.slug, packLabel(lib, a.pack, T), a.pack === MINE_PACK && !a.overrides, T);
    if (u) { setNote({ text: u.text, undo: u }); reload(); }
  });
  const undo = () => run(async () => { if (note?.undo) { await undoItem(lang, 'avatars', note.undo.slug); setNote({ text: T.undone }); reload(); } });

  return (
    <div className="space-y-3" data-testid="avatar-library">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setUpload(true)} data-testid="avatar-new"><Plus size={14} />{T.upload}</Button>
        {hiddenCount > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-gray-500">
            <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />{T.showHidden} ({hiddenCount})
          </label>
        )}
      </div>
      {list.length === 0 && <p className="text-sm text-gray-500">{T.emptyAvatars}</p>}
      <div className="grid gap-2 grid-cols-3 sm:grid-cols-4 lg:grid-cols-6">
        {list.map((a) => (
          <div key={a.slug} className={cn('flex flex-col items-center gap-1 p-2 rounded-xl border border-gray-200 dark:border-gray-700', a.hidden && 'opacity-50')} data-testid={`avatar-card-${a.slug}`}>
            <LibraryAvatar url={a.url} name={a.slug} size={64} />
            <span className="text-xs font-medium truncate max-w-full">{a.slug}</span>
            <span className="text-[11px] text-gray-400 truncate max-w-full">{packLabel(lib, a.pack, T)}{a.overrides && <Badge variant="info" className="ml-1">{T.editedTag}</Badge>}</span>
            {a.in_use?.length ? <span className="text-[11px] text-gray-400 truncate max-w-full">{T.inUse}{a.in_use.join('、')}</span> : null}
            <div className="flex gap-0.5">
              {a.hidden
                ? <Button size="sm" variant="ghost" title={T.show} onClick={() => run(async () => { await undoItem(lang, 'avatars', a.slug); reload(); })}><Eye size={14} /></Button>
                : <>
                    {a.overrides && <Button size="sm" variant="ghost" title={T.reset} onClick={() => run(async () => { await resetItem(lang, 'avatars', a.slug); setNote({ text: T.reset, undo: { kind: 'avatars', slug: a.slug, text: '' } }); reload(); })}><RotateCcw size={14} /></Button>}
                    <Button size="sm" variant="ghost" title={a.pack === MINE_PACK && !a.overrides ? T.remove : T.hide} onClick={() => remove(a)} data-testid={`avatar-remove-${a.slug}`}><Trash2 size={14} /></Button>
                  </>}
            </div>
          </div>
        ))}
      </div>
      {error && <p className="text-sm text-red-500" role="alert">{error}</p>}
      <Notice note={note && { text: note.text, undo: !!note.undo }} onUndo={undo} onClose={() => setNote(null)} T={T} />
      <AvatarUpload open={upload} onClose={() => setUpload(false)} lang={lang} T={T} onSaved={(slug) => { setNote({ text: fmt(T.installed, { name: slug }) }); reload(); }} />
    </div>
  );
}
