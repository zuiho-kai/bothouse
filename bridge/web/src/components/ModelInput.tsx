import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Download, Loader2 } from 'lucide-react';
import { listProviderModels } from '@/api/wizard';
import { cn } from '@/lib/utils';

// #2115: the model box, as CC Switch's provider form has it — 「获取模型列表」 reads the relay's
// /v1/models (POST /setup/provider/models), the list opens and a click fills the box; the box stays
// free text, so a model the relay does not list can still be typed. One component for the setup
// wizard and the management pages' provider forms.
// vendor: the wizard's vendor id — the list is read from that vendor's own base when base_url is empty.
export function ModelInput({
  label, value, onChange, baseUrl, apiKey, vendor, placeholder, testid, onKeyDown, className,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  baseUrl?: string;
  apiKey?: string;
  vendor?: string;
  placeholder?: string;
  testid?: string;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const [models, setModels] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const tid = (s: string) => (testid ? `${testid}-${s}` : undefined);

  // a list read with another URL or key is not this relay's list
  useEffect(() => { setModels([]); setMsg(null); setOpen(false); }, [baseUrl, apiKey, vendor]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const fetchModels = () => {
    const hasBase = !!baseUrl?.trim() || (!!vendor && vendor !== 'custom');
    const hasKey = !!apiKey?.trim();
    if (!hasBase || !hasKey) {
      setMsg({ bad: true, text: !hasBase && !hasKey ? t('modelInput.needConfig', '请先填写 API 地址和 API Key')
        : !hasKey ? t('modelInput.needKey', '请先填写 API Key') : t('modelInput.needBase', '请先填写 API 地址') });
      return;
    }
    setFetching(true);
    setMsg(null);
    listProviderModels({ vendor: vendor || '', base_url: baseUrl?.trim() || '', api_key: apiKey!.trim() })
      .then((res) => {
        const ids = res.models || [];
        setModels(ids);
        if (res.error) setMsg({ bad: true, text: failText(res.error) });
        else if (ids.length === 0) setMsg({ text: t('modelInput.empty', '未找到可用模型') });
        else { setMsg({ text: t('modelInput.success', { count: ids.length, defaultValue: '获取到 {{count}} 个模型' }) }); setQuery(''); setOpen(true); }
      })
      .catch((e) => setMsg({ bad: true, text: failText(String(e?.message || e)) }))
      .finally(() => setFetching(false));
  };
  const failText = (err: string) =>
    /HTTP 40[13]/.test(err) ? t('modelInput.authFailed', 'API Key 无效或无权限')
      : /HTTP 40[45]/.test(err) ? t('modelInput.notFound', '这个地址没有模型列表接口，检查 API 地址')
        : `${t('modelInput.failed', '获取模型列表失败')}：${err}`;

  const q = query.trim().toLowerCase();
  const shown = q ? models.filter((m) => m.toLowerCase().includes(q)) : models;

  return (
    <div className={cn('space-y-1.5', className)} ref={box}>
      <div className="flex items-center justify-between gap-2">
        {label ? <label className="block text-sm font-medium text-ink-soft">{label}</label> : <span />}
        <button type="button" onClick={fetchModels} disabled={fetching} data-testid={tid('fetch')}
          className="inline-flex h-6 items-center gap-1 rounded-control border border-hairline px-2 text-xs text-ink-soft hover:border-hairline-strong disabled:opacity-60">
          {fetching ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
          {fetching ? t('modelInput.fetching', '正在获取...') : t('modelInput.fetch', '获取模型列表')}
        </button>
      </div>
      <div className="relative flex gap-1">
        <input value={value} placeholder={placeholder} data-testid={testid} onKeyDown={onKeyDown}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 text-sm rounded-control text-ink bg-surface border border-hairline hover:border-hairline-strong placeholder:text-ink-mute focus:outline-none focus:ring-2 focus:ring-accent-text focus:ring-offset-2 focus:ring-offset-canvas" />
        {models.length > 0 && (
          <button type="button" aria-label={t('modelInput.select', '选择模型')} title={t('modelInput.select', '选择模型')}
            onClick={() => { setQuery(''); setOpen((o) => !o); }} data-testid={tid('toggle')}
            className="shrink-0 rounded-control border border-hairline px-2 text-ink-soft hover:border-hairline-strong">
            <ChevronDown size={16} />
          </button>
        )}
        {open && models.length > 0 && (
          <div className="absolute right-0 top-full z-50 mt-1 w-72 max-w-[90vw] rounded-card border border-hairline bg-surface shadow-lg" data-testid={tid('list')}>
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('modelInput.search', '搜索模型...')}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (shown[0]) { onChange(shown[0]); setOpen(false); } } if (e.key === 'Escape') setOpen(false); }}
              className="w-full border-b border-hairline bg-transparent px-3 py-2 text-sm text-ink focus:outline-none" data-testid={tid('search')} />
            <ul className="max-h-64 overflow-y-auto py-1">
              {shown.length === 0 && <li className="px-3 py-2 text-sm text-ink-mute">{t('modelInput.noMatch', '没有匹配的模型')}</li>}
              {shown.map((m) => (
                <li key={m}>
                  <button type="button" onClick={() => { onChange(m); setOpen(false); }} data-testid={tid('option')}
                    className={cn('block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-surface-sunken', m === value ? 'text-accent-text font-medium' : 'text-ink')}
                    title={m}>{m}</button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {msg && <p className={cn('text-xs', msg.bad ? 'text-red-500' : 'text-ink-mute')} data-testid={tid('msg')}>{msg.text}</p>}
    </div>
  );
}
