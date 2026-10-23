import { useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button, Input, Modal } from '@/components/ui';
import { uploadAvatar } from '@/api/library';
import type { LibraryTexts } from '@/pages/Setup/texts';
import { cn } from '@/lib/utils';

// Output edge of the cropped square: the bundled avatars are 256×256 (public/avatars/README.md).
const EDGE = 256;

/** Center-crop a picture to an EDGE×EDGE PNG. */
async function cropSquare(file: Blob): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('bad image')); i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    if (!side) throw new Error('bad image');
    const c = document.createElement('canvas');
    c.width = EDGE; c.height = EDGE;
    c.getContext('2d')!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, EDGE, EDGE);
    return await new Promise<Blob>((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error('bad image'))), 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}

/** Drop or pick a picture → centered square crop with a round preview → saved into "mine". */
export function AvatarUpload({ open, onClose, onSaved, lang, T }: {
  open: boolean; onClose: () => void; onSaved: (slug: string, url: string) => void; lang: string; T: LibraryTexts;
}) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [preview, setPreview] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!open) { setBlob(null); setPreview(''); setName(''); setError(''); } }, [open]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const take = async (f: File | undefined) => {
    if (!f) return;
    setError('');
    try {
      const b = await cropSquare(f);
      setBlob(b); setPreview(URL.createObjectURL(b));
      if (!name) setName(f.name.replace(/\.[^.]+$/, ''));
    } catch { setBlob(null); setPreview(''); setError(T.badImage); }
  };
  const save = async () => {
    if (!blob) return;
    setBusy(true); setError('');
    try { const r = await uploadAvatar(lang, blob, { name }); onSaved(r.slug, r.url); onClose(); }
    catch (e: any) { setError(e?.message || String(e)); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={T.uploadTitle}>
      <div className="space-y-3" data-testid="avatar-upload">
        <button type="button" onClick={() => input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files[0]); }}
          className={cn('w-full flex flex-col items-center justify-center gap-2 p-6 rounded-xl border-2 border-dashed text-sm text-gray-500 transition-colors',
            over ? 'border-accent bg-accent/5' : 'border-gray-300 dark:border-gray-700 hover:border-accent/60')}
          data-testid="avatar-drop">
          {preview
            ? <img src={preview} alt="" className="w-28 h-28 rounded-full object-cover shadow" data-testid="avatar-preview" />
            : <Upload size={28} className="opacity-60" />}
          <span>{T.dropHere}</span>
        </button>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden"
          onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }} data-testid="avatar-file" />
        <p className="text-xs text-gray-500">{T.cropNote}</p>
        <Input label={T.avatarName} value={name} onChange={(e) => setName(e.target.value)} data-testid="avatar-name" />
        {error && <p className="text-sm text-red-500" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{T.cancel}</Button>
          <Button onClick={save} disabled={!blob || busy} data-testid="avatar-save">{busy ? T.saving : T.save}</Button>
        </div>
      </div>
    </Modal>
  );
}
