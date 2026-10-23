import { useRef, useState } from 'react';
import { Download, PackagePlus, Trash2 } from 'lucide-react';
import { Badge, Button, Input, Modal } from '@/components/ui';
import {
  exportPack, installPack, MINE_PACK, previewPackFile, previewPackURL, setPackEnabled, uninstallPack,
  type Library, type PackManifest, type PackPreview,
} from '@/api/library';
import { fmt, type LibraryTexts } from '@/pages/Setup/texts';
import { LibraryAvatar } from './LibraryAvatar';

/** Installed packs (enable / disable / uninstall), install with a preview first, export a selection as a pack. */
export function PackManager({ lib, lang, T, reload }: { lib: Library; lang: string; T: LibraryTexts; reload: () => void }) {
  const [preview, setPreview] = useState<PackPreview | null>(null);
  const [url, setURL] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [exporting, setExporting] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn(); } catch (e: any) { setError(e?.message || String(e)); } finally { setBusy(false); } };

  return (
    <div className="space-y-4" data-testid="pack-manager">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{T.packs}</h3>
        {lib.packs.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-700" data-testid={`pack-${p.id}`}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                {p.id === MINE_PACK ? T.mine : p.name}
                {p.builtin && <Badge>{T.builtin}</Badge>}
                {p.version && <span className="text-xs text-gray-400">v{p.version}</span>}
                {p.license && <span className="text-xs text-gray-400">{p.license}</span>}
              </div>
              <p className="text-xs text-gray-500">{[p.author, p.description, fmt(T.personaCount, { n: p.personas }), fmt(T.avatarCount, { n: p.avatars })].filter(Boolean).join(' · ')}</p>
            </div>
            {!p.builtin && !p.writable && (
              <>
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={p.enabled} disabled={busy} data-testid={`pack-toggle-${p.id}`}
                    onChange={(e) => run(async () => { await setPackEnabled(lang, p.id, e.target.checked); reload(); })} />
                  {p.enabled ? T.enabled : T.disabled}
                </label>
                <Button size="sm" variant="ghost" title={T.uninstall} disabled={busy} data-testid={`pack-uninstall-${p.id}`}
                  onClick={() => window.confirm(fmt(T.uninstallConfirm, { name: p.name })) && run(async () => { await uninstallPack(lang, p.id); reload(); })}>
                  <Trash2 size={14} />
                </Button>
              </>
            )}
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{T.install}</h3>
        <div className="flex flex-wrap items-end gap-2">
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => file.current?.click()} data-testid="pack-file-btn"><PackagePlus size={14} />{T.installFile}</Button>
          <input ref={file} type="file" accept=".zip,application/zip" className="hidden" data-testid="pack-file"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) run(async () => setPreview(await previewPackFile(lang, f))); }} />
          <div className="flex-1 min-w-[16rem]"><Input placeholder={T.installURL} value={url} onChange={(e) => setURL(e.target.value)} data-testid="pack-url" /></div>
          <Button size="sm" variant="secondary" disabled={busy || !/^https:\/\//.test(url)} onClick={() => run(async () => setPreview(await previewPackURL(lang, url)))} data-testid="pack-url-preview">{T.previewBtn}</Button>
          <Button size="sm" variant="secondary" onClick={() => setExporting(true)} data-testid="pack-export-btn"><Download size={14} />{T.exportBtn}</Button>
        </div>
        {note && <p className="text-sm text-green-600" role="status">{note}</p>}
        {error && <p className="text-sm text-red-500" role="alert">{error}</p>}
      </section>

      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview ? fmt(T.previewTitle, { name: preview.manifest.name }) : ''} className="max-w-2xl">
        {preview && (
          <div className="space-y-3 max-h-[70vh] overflow-y-auto" data-testid="pack-preview">
            <p className="text-xs text-gray-500">{[preview.manifest.id, preview.manifest.version && `v${preview.manifest.version}`, preview.manifest.author, preview.manifest.license, preview.manifest.description].filter(Boolean).join(' · ')}</p>
            {preview.replaces !== undefined && preview.replaces !== '' && <p className="text-sm text-amber-600">{fmt(T.replaces, { version: preview.replaces })}</p>}
            {!!preview.conflicts?.length && <p className="text-sm text-amber-600">{T.conflicts}{preview.conflicts.join('、')}</p>}
            {!!preview.skipped?.length && <p className="text-xs text-gray-400">{T.skippedFiles}{preview.skipped.join('、')}</p>}
            <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
              {preview.personas.map((p) => (
                <div key={p.slug} className="flex items-start gap-2 p-2 rounded-lg border border-gray-200 dark:border-gray-700">
                  <LibraryAvatar url={preview.avatars.find((a) => a.slug === p.avatar)?.url || lib.avatars.find((a) => a.slug === p.avatar)?.url} name={p.name} size={36} />
                  <div className="min-w-0"><p className="text-sm font-medium">{p.name}</p><p className="text-xs text-gray-500 line-clamp-2">{p.intro}</p></div>
                </div>
              ))}
            </div>
            {preview.avatars.length > 0 && (
              <div className="flex flex-wrap gap-2">{preview.avatars.map((a) => <LibraryAvatar key={a.slug} url={a.url} name={a.slug} size={40} />)}</div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPreview(null)}>{T.cancel}</Button>
              <Button disabled={busy} data-testid="pack-install"
                onClick={() => run(async () => { const m = await installPack(lang, preview.staging); setPreview(null); setURL(''); setNote(fmt(T.installed, { name: m.name })); reload(); })}>
                {T.confirmInstall}
              </Button>
            </div>
          </div>
        )}
      </Modal>
      <ExportDialog open={exporting} onClose={() => setExporting(false)} lib={lib} lang={lang} T={T} />
    </div>
  );
}

function ExportDialog({ open, onClose, lib, lang, T }: { open: boolean; onClose: () => void; lib: Library; lang: string; T: LibraryTexts }) {
  const [m, setM] = useState<PackManifest>({ id: '', name: '', author: '', version: '', license: '', description: '' });
  const [personas, setPersonas] = useState<string[]>([]);
  const [avatars, setAvatars] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const flip = (list: string[], set: (v: string[]) => void, s: string) => set(list.includes(s) ? list.filter((x) => x !== s) : [...list, s]);
  const ok = !!m.id && !!m.name.trim() && !!m.license?.trim() && personas.length + avatars.length > 0;
  const download = async () => {
    setBusy(true); setError('');
    try {
      const blob = await exportPack(lang, m, personas, avatars);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `${m.id}.zip`; a.click();
      URL.revokeObjectURL(a.href); onClose();
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={T.exportTitle} className="max-w-2xl">
      <div className="space-y-3 max-h-[75vh] overflow-y-auto pr-1" data-testid="pack-export">
        <div className="grid gap-2 sm:grid-cols-2">
          <Input label={T.packId} value={m.id} onChange={(e) => setM({ ...m, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} data-testid="export-id" />
          <Input label={T.packName} value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} data-testid="export-name" />
          <Input label={T.author} value={m.author} onChange={(e) => setM({ ...m, author: e.target.value })} />
          <Input label={T.version} value={m.version} onChange={(e) => setM({ ...m, version: e.target.value })} />
          <Input label={T.license} value={m.license} onChange={(e) => setM({ ...m, license: e.target.value })} data-testid="export-license" />
          <Input label={T.description} value={m.description} onChange={(e) => setM({ ...m, description: e.target.value })} />
        </div>
        <p className="text-sm font-medium">{T.choosePersonas}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {lib.personas.filter((p) => !p.hidden).map((p) => (
            <label key={p.slug} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={personas.includes(p.slug)} onChange={() => flip(personas, setPersonas, p.slug)} />{p.name}</label>
          ))}
        </div>
        <p className="text-sm font-medium">{T.chooseAvatars}</p>
        <div className="flex flex-wrap gap-2">
          {lib.avatars.filter((a) => !a.hidden).map((a) => (
            <label key={a.slug} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={avatars.includes(a.slug)} onChange={() => flip(avatars, setAvatars, a.slug)} /><LibraryAvatar url={a.url} name={a.slug} size={28} />{a.slug}</label>
          ))}
        </div>
        {error && <p className="text-sm text-red-500" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{T.cancel}</Button>
          <Button disabled={!ok || busy} onClick={download} data-testid="export-download"><Download size={14} />{T.download}</Button>
        </div>
      </div>
    </Modal>
  );
}
