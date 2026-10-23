import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, Input, Modal, Textarea } from '@/components/ui';
import { createPersona, updatePersona, type ApplyResult, type Library, type LibraryPersona } from '@/api/library';
import type { LibraryTexts } from '@/pages/Setup/texts';
import { cn } from '@/lib/utils';
import { LibraryAvatar } from './LibraryAvatar';
import { AvatarUpload } from './AvatarUpload';

/** What the editor opens with: an existing slug = edit it; no slug = create (new or copy). */
export interface PersonaDraft { slug?: string; name: string; intro: string; avatar: string; text: string }

/** Avatar choice row: none (initial badge), every shown library avatar, and upload. */
export function AvatarChoice({ lib, value, onChange, name, lang, T, onUploaded }: {
  lib: Library; value: string; onChange: (slug: string) => void; name: string; lang: string; T: LibraryTexts; onUploaded: () => void;
}) {
  const [upload, setUpload] = useState(false);
  const shown = lib.avatars.filter((a) => !a.hidden || a.slug === value);
  const opt = (selected: boolean) => cn('rounded-full p-0.5 border-2 transition-colors', selected ? 'border-accent' : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600');
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={T.avatar} data-testid="avatar-choice">
      <button type="button" role="radio" aria-checked={value === ''} title={T.noAvatar} className={opt(value === '')} onClick={() => onChange('')} data-testid="avatar-opt-none">
        <LibraryAvatar name={name} size={40} />
      </button>
      {shown.map((a) => (
        <button key={a.slug} type="button" role="radio" aria-checked={value === a.slug} title={a.slug} className={opt(value === a.slug)}
          onClick={() => onChange(a.slug)} data-testid={`avatar-opt-${a.slug}`}>
          <LibraryAvatar url={a.url} name={name} size={40} />
        </button>
      ))}
      <button type="button" title={T.upload} onClick={() => setUpload(true)} data-testid="avatar-opt-upload"
        className="w-11 h-11 rounded-full grid place-items-center border-2 border-dashed border-gray-300 dark:border-gray-600 text-gray-400 hover:text-accent hover:border-accent">
        <Plus size={18} />
      </button>
      <AvatarUpload open={upload} onClose={() => setUpload(false)} lang={lang} T={T}
        onSaved={(slug) => { onUploaded(); onChange(slug); }} />
    </div>
  );
}

/** Create / edit / copy one persona. Saving an edit also rewrites the roles that use it (reported back). */
export function PersonaEditor({ draft, lib, lang, T, onClose, onSaved, reload }: {
  draft: PersonaDraft | null; lib: Library; lang: string; T: LibraryTexts;
  onClose: () => void; onSaved: (p: LibraryPersona, r: ApplyResult) => void; reload: () => void;
}) {
  const [d, setD] = useState<PersonaDraft>({ name: '', intro: '', avatar: '', text: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (draft) { setD(draft); setError(''); } }, [draft]);
  const editing = !!draft?.slug;

  const save = async () => {
    setBusy(true); setError('');
    const body = { name: d.name.trim(), intro: d.intro.trim(), avatar: d.avatar, text: d.text };
    try {
      const r = editing ? await updatePersona(lang, d.slug!, body) : await createPersona(lang, body);
      onSaved({ ...body, slug: r.slug, pack: 'mine' }, r); onClose();
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={!!draft} onClose={onClose} title={editing ? `${T.edit} · ${draft?.name}` : T.newPersona} className="max-w-2xl">
      <div className="space-y-3 max-h-[75vh] overflow-y-auto pr-1" data-testid="persona-editor-dialog">
        <div className="flex items-start gap-3">
          <LibraryAvatar url={lib.avatars.find((a) => a.slug === d.avatar)?.url} name={d.name} size={64} />
          <div className="flex-1 space-y-2">
            <Input label={T.name} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} data-testid="persona-name" />
            <Input label={T.intro} value={d.intro} onChange={(e) => setD({ ...d, intro: e.target.value })} data-testid="persona-intro" />
          </div>
        </div>
        <div className="space-y-1.5">
          <span className="block text-sm font-medium text-gray-700 dark:text-gray-300">{T.avatar}</span>
          <AvatarChoice lib={lib} value={d.avatar} onChange={(avatar) => setD((x) => ({ ...x, avatar }))} name={d.name} lang={lang} T={T} onUploaded={reload} />
        </div>
        <Textarea label={T.text} rows={12} value={d.text} onChange={(e) => setD({ ...d, text: e.target.value })} data-testid="persona-text" />
        {error && <p className="text-sm text-red-500" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{T.cancel}</Button>
          <Button onClick={save} disabled={busy || !d.name.trim()} data-testid="persona-save">{busy ? T.saving : T.save}</Button>
        </div>
      </div>
    </Modal>
  );
}
