import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, ImageOff, Sparkles } from 'lucide-react';
import { Button, Card, EmptyState, LoadingState, PageHeader, Textarea } from '@/components/ui';
import { drawImage, getImageGen, type ImageGenResult, type ImageGenState } from '@/api/imagegen';
import { withBase } from '@/lib/basePath';
import { imageGenTexts } from './texts';

/**
 * 生图 (#150 第 c 项): draws one picture from the configured [image_gen] service and
 * shows where the file landed.
 *
 * Deliberately not a "post it to QQ" button. Drawing costs a paid API call and posting
 * spends a channel's attention, so those stay two separate decisions: the page writes a
 * file and prints the `bothouse send --image` line for the owner to run when they choose.
 */
export default function ImageGenPage() {
  const { i18n } = useTranslation();
  const T = imageGenTexts(i18n.language || 'en');
  const [state, setState] = useState<ImageGenState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [prompt, setPrompt] = useState('');
  const [drawing, setDrawing] = useState(false);
  const [drawError, setDrawError] = useState('');
  const [latest, setLatest] = useState<ImageGenResult | null>(null);
  const [copied, setCopied] = useState('');

  const fetchData = useCallback(async () => {
    try {
      setState(await getImageGen());
      setError('');
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const handler = () => fetchData();
    window.addEventListener('cc:refresh', handler);
    return () => window.removeEventListener('cc:refresh', handler);
  }, [fetchData]);

  const draw = async () => {
    const want = prompt.trim();
    if (!want) return;
    // The confirm is the "this costs money" gate: nobody buys a picture by pressing Enter.
    if (!confirm(`${T.draw}？\n\n${T.costNote}`)) return;
    setDrawing(true);
    setDrawError('');
    try {
      const res = await drawImage(want);
      setLatest(res);
      await fetchData();
    } catch (e: any) {
      setDrawError(e?.message || String(e));
    } finally {
      setDrawing(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
    } catch {
      /* clipboard blocked: the path is on screen and selectable anyway */
    }
  };

  if (loading) return <LoadingState label={T.drawing} />;

  return (
    <div className="space-y-4" data-testid="image-gen-page">
      <PageHeader title={T.title} description={T.subtitle} icon={Sparkles} />

      {error && <p className="text-sm text-red-700 dark:text-red-400" role="alert">{error}</p>}

      {state && state.status !== 'ready' && (
        <Card>
          {/* Two different problems, two different fixes: an absent section versus a setting
              that cannot be honoured (e.g. out_dir outside data_dir). Saying "not configured"
              for the second sent the owner looking for a section that was already there. */}
          <h2 className="text-sm font-semibold text-ink" data-testid="image-gen-unconfigured">
            {state.status === 'error' ? T.misconfigured : T.notConfigured}
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            {state.status === 'error' ? T.misconfiguredHint : T.notConfiguredHint}
          </p>
          {state.message && <p className="mt-2 font-mono text-xs text-ink-mute">{state.message}</p>}
          <p className="mt-3 text-[13px] text-ink-mute">{T.providersHint}</p>
          <p className="mt-1 text-[13px] text-ink-mute">{T.restartNote}</p>
        </Card>
      )}

      {state?.status === 'ready' && (
        <Card>
          <Textarea
            label={T.promptLabel}
            rows={3}
            value={prompt}
            placeholder={T.promptPlaceholder}
            onChange={(e) => setPrompt(e.target.value)}
            data-testid="image-gen-prompt"
          />
          {!state.api_key_set && (
            <p className="mt-2 text-sm text-red-700 dark:text-red-400">{T.apiKeyMissing}</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button
              onClick={draw}
              loading={drawing}
              disabled={drawing || !prompt.trim() || !state.can_draw}
              data-testid="image-gen-draw"
            >
              <Sparkles size={16} />
              {drawing ? T.drawing : latest ? T.drawAgain : T.draw}
            </Button>
            <span className="text-[13px] text-ink-mute">{T.costNote}</span>
          </div>
          <p className="mt-2 text-[13px] text-ink-mute">
            {T.modelLabel}: <span className="font-mono">{state.model}</span>
          </p>
          {drawError && (
            <p className="mt-3 text-sm text-red-700 dark:text-red-400" role="alert" data-testid="image-gen-error">
              {T.failed(drawError)}
            </p>
          )}
        </Card>
      )}

      {latest && (
        <Card>
          <div data-testid="image-gen-latest" className="grid gap-4 sm:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
            <img
              src={withBase(latest.url)}
              alt=""
              className="w-full rounded-control border border-hairline bg-surface-sunken object-contain"
            />
            <div className="min-w-0 space-y-2">
              <p className="text-[13px] font-medium text-ink-soft">{T.fileLabel}</p>
              <div className="flex items-start gap-2">
                <code
                  className="min-w-0 flex-1 break-all rounded-control bg-surface-sunken px-2 py-1 font-mono text-xs text-ink-soft ring-1 ring-hairline"
                  data-testid="image-gen-path"
                >
                  {latest.file}
                </code>
                <Button size="sm" variant="secondary" onClick={() => copy(latest.file)}>
                  <Copy size={14} />{copied === latest.file ? T.copied : T.copyPath}
                </Button>
              </div>
              <p className="text-[13px] font-medium text-ink-soft">{T.sendLabel}</p>
              <p className="text-[13px] text-ink-mute">{T.sendHint}</p>
              <pre className="overflow-auto whitespace-pre rounded-control bg-surface-sunken p-2 font-mono text-xs text-ink-soft ring-1 ring-hairline">
{`bothouse send --project <项目> --session <会话> --image "${latest.file}"`}
              </pre>
            </div>
          </div>
        </Card>
      )}

      {state?.status === 'ready' && (
        <Card>
          <h2 className="text-sm font-semibold text-ink">{T.recent}</h2>
          {state.pictures.length === 0 ? (
            <EmptyState icon={ImageOff} message={T.emptySaved} hint={T.emptySavedHint} />
          ) : (
            <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="image-gen-list">
              {state.pictures.map((p) => (
                <li key={p.name} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => setLatest(p)}
                    className="block w-full rounded-control p-1 text-left transition-colors duration-base ease-ui-out hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-text"
                    data-testid={`image-gen-picture-${p.name}`}
                  >
                    <img
                      src={withBase(p.url)}
                      alt=""
                      className="aspect-square w-full rounded-control border border-hairline bg-surface-sunken object-cover"
                    />
                    <span className="mt-1 block truncate font-mono text-[11px] text-ink-mute">{p.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}