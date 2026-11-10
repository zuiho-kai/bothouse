import { useEffect, useState } from 'react';
import { Download, ExternalLink, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui';
import { fetchShowcasePack, type PetShowcasePack } from '@/api/pets';

/**
 * 形象包来源（#549）：开源展示包一键从作者仓库下载（bothouse 只带清单，不转存素材），
 * 下载进行中时每 2 秒刷新一次列表。
 */
export function PetPackSources({
  showcase,
  onChanged,
  disabled,
}: {
  showcase: PetShowcasePack[];
  onChanged?: () => void;
  disabled?: boolean;
}) {
  const busy = showcase.some(p => p.fetch?.state === 'downloading');
  useEffect(() => {
    if (!busy || !onChanged) return;
    const t = setInterval(onChanged, 2000); // 2 秒：与桌宠读角色绑定的轮询间隔一致（pet.go pollBindings）
    return () => clearInterval(t);
  }, [busy, onChanged]);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const download = async (id: string) => {
    setErrors(e => ({ ...e, [id]: '' }));
    try {
      await fetchShowcasePack(id);
    } catch (err) {
      setErrors(e => ({ ...e, [id]: err instanceof Error ? err.message : String(err) }));
    }
    onChanged?.();
  };

  return (
    <div className="space-y-5">
      <div className="space-y-3" data-testid="pet-showcase-section">
        <div className="flex items-center gap-2 text-xs font-semibold text-ink">
          <Download size={14} className="text-amber-500" />
          <span>开源形象包（{showcase.length}）</span>
          <span className="text-[11px] text-ink-mute font-normal">点了才从作者仓库下载并逐个校验，bothouse 不转存</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {showcase.map(pack => {
            const f = pack.fetch;
            const downloading = f?.state === 'downloading';
            const err = errors[pack.id] || (f?.state === 'failed' ? f.error : '');
            return (
              <div key={pack.id} data-testid={`showcase-pack-${pack.id}`}
                className="rounded-xl border border-hairline bg-surface-sunken/40 p-3.5 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-semibold text-ink text-sm">{pack.name}</span>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <Badge variant={pack.installed ? 'success' : 'outline'} className="text-[10px]">
                        {pack.installed ? '本机已装' : '未下载'}
                      </Badge>
                      {pack.forRole && <Badge variant="outline" className="text-[10px]">适合 {pack.forRole} 角色</Badge>}
                      <span className="text-[10px] text-ink-mute">约 {Math.round(pack.bytes / 1e6)} MB</span>
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-ink-soft">{pack.description}</p>
                <div className="text-[11px] text-ink-mute bg-surface rounded p-2 ring-1 ring-hairline space-y-1">
                  <p>
                    <span className="font-medium text-ink">来源：</span>
                    <a href={pack.source} target="_blank" rel="noreferrer" className="hover:text-accent inline-flex items-center gap-0.5">
                      {pack.source.replace('https://github.com/', '').replace(/\/tree\/([0-9a-f]{7})[0-9a-f]+/, '@$1')}
                      <ExternalLink size={10} />
                    </a>
                  </p>
                  <p><span className="font-medium text-ink">许可：</span>{pack.license}</p>
                </div>
                {err && (
                  <p className="text-[11px] text-red-600 flex items-start gap-1" data-testid={`showcase-error-${pack.id}`}>
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    <span>{err}。默认形象不受影响。</span>
                  </p>
                )}
                <button
                  type="button"
                  data-testid={`showcase-download-${pack.id}`}
                  disabled={disabled || pack.installed || downloading}
                  onClick={() => void download(pack.id)}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-surface-hover hover:text-accent transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {downloading ? <Loader2 size={12} className="animate-spin" /> : pack.installed ? <CheckCircle2 size={12} /> : <Download size={12} />}
                  <span>
                    {downloading ? `下载中 ${f?.done ?? 0}/${f?.total ?? 0}` : pack.installed ? '已下载，可在上面给角色选它' : '从作者仓库下载到本机'}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

