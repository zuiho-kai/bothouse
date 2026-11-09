import { useEffect, useRef, useState } from 'react';
import { FolderOpen, FileArchive, Loader2 } from 'lucide-react';
import { importPetPack, type InstalledPetPack } from '@/api/pets';

/**
 * 导入自己的形象包（#549）：选文件夹或 zip，检查通过后出现在每个角色的形象下拉里；给角色选上后，
 * `bothouse pet run` 把它做成那只桌宠的形象。桌面转换进行中时每 2 秒刷新一次列表。
 */
export function PetPackImport({ installed, onChanged, disabled }: { installed: InstalledPetPack[]; onChanged?: () => void; disabled?: boolean }) {
  const busy = installed.some(p => p.desktop?.state === 'converting');
  useEffect(() => {
    if (!busy || !onChanged) return;
    const t = setInterval(onChanged, 2000); // 2 秒：与桌宠读角色绑定的轮询间隔一致（pet.go pollBindings）
    return () => clearInterval(t);
  }, [busy, onChanged]);
  const folderRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [state, setState] = useState<{ busy: boolean; ok?: string; error?: string }>({ busy: false });

  useEffect(() => {
    // webkitdirectory 不在 React 的属性类型里：挂载后直接设到元素上。
    folderRef.current?.setAttribute('webkitdirectory', '');
  }, []);

  const run = async (input: { zip?: File; files?: File[] }) => {
    setState({ busy: true });
    try {
      const pack = await importPetPack({ ...input, name: name.trim() || undefined });
      setState({ busy: false, ok: `已导入「${pack.name || pack.id}」，${pack.actionCount} 个动作，现在可以在上面给角色选它，桌面上那个角色的桌宠会换成它。` });
      setName('');
      onChanged?.();
    } catch (err) {
      setState({ busy: false, error: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-dashed border-hairline p-3.5" data-testid="pet-import-section">
      <div className="flex items-center gap-2 text-xs font-semibold text-ink">
        <FolderOpen size={14} className="text-accent" />
        <span>导入自己的形象包</span>
        <span className="text-[11px] text-ink-mute font-normal">WebP 精灵图包（manifest.json）或 dsh-pet 透明 WebM 包（config.jsonc），见 docs/plugins/pet-packs.md</span>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="名字（可不填，默认用文件夹名）"
          data-testid="pet-import-name"
          className="h-8 flex-1 rounded-md border border-hairline bg-surface px-2.5 text-xs text-ink focus:border-accent focus:outline-none"
        />
        <button type="button" disabled={disabled || state.busy} onClick={() => folderRef.current?.click()}
          data-testid="pet-import-folder"
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-hover disabled:opacity-60">
          <FolderOpen size={12} /><span>选文件夹</span>
        </button>
        <button type="button" disabled={disabled || state.busy} onClick={() => zipRef.current?.click()}
          data-testid="pet-import-zip"
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-hover disabled:opacity-60">
          <FileArchive size={12} /><span>选 zip</span>
        </button>
      </div>
      <input ref={folderRef} type="file" multiple hidden data-testid="pet-import-folder-input"
        onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ''; if (files.length) void run({ files }); }} />
      <input ref={zipRef} type="file" accept=".zip,application/zip" hidden data-testid="pet-import-zip-input"
        onChange={e => { const zip = e.target.files?.[0]; e.target.value = ''; if (zip) void run({ zip }); }} />
      {state.busy && <p className="text-[11px] text-ink-mute flex items-center gap-1"><Loader2 size={12} className="animate-spin" />正在上传并检查……</p>}
      {state.ok && <p className="text-[11px] text-emerald-600" data-testid="pet-import-ok">{state.ok}</p>}
      {state.error && <p className="text-[11px] text-red-600" data-testid="pet-import-error">导入失败：{state.error}</p>}
    </div>
  );
}

/** 已装形象包在桌面桌宠里的准备情况（精灵图要先转成透明视频）。 */
export function petDesktopLine(pack: InstalledPetPack): { text: string; tone: 'ok' | 'busy' | 'bad' } | null {
  const d = pack.desktop;
  if (!d) return null;
  if (d.state === 'converting') return { text: `桌面桌宠素材准备中 ${d.done}/${d.total}`, tone: 'busy' };
  if (d.state === 'failed') return { text: `桌面桌宠用不了这个包：${d.error ?? '转换失败'}（角色先用默认形象）`, tone: 'bad' };
  if (d.state === 'ready') return { text: '桌面桌宠已可用', tone: 'ok' };
  return null;
}
