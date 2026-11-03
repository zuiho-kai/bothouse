import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { FileCode, RefreshCw, RotateCcw, ChevronDown, ChevronRight, Settings2 } from 'lucide-react';
import { Card, Button, PageHeader, LoadingState } from '@/components/ui';
import { restartSystem, reloadConfig } from '@/api/status';
import api from '@/api/client';
import GlobalSettings from './GlobalSettings';

export default function SystemConfig() {
  const { t } = useTranslation();
  const [content, setContent] = useState('');
  const [format, setFormat] = useState<'toml' | 'json'>('toml');
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState('');
  const [showRaw, setShowRaw] = useState(false);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const text = await api.raw('/config');
      const trimmed = text.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const obj = JSON.parse(trimmed);
          setContent(JSON.stringify(obj, null, 2));
          setFormat('json');
        } catch {
          setContent(text);
          setFormat('toml');
        }
      } else {
        setContent(text);
        setFormat('toml');
      }
    } catch {
      setContent('');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
    const handler = () => fetchConfig();
    window.addEventListener('cc:refresh', handler);
    return () => window.removeEventListener('cc:refresh', handler);
  }, [fetchConfig]);

  const handleRestart = async () => {
    if (!confirm(t('system.restartConfirm'))) return;
    try {
      await restartSystem();
      setActionMsg(t('common.success'));
    } catch (e: any) {
      setActionMsg(e.message);
    }
  };

  const handleReload = async () => {
    if (!confirm(t('system.reloadConfirm'))) return;
    try {
      await reloadConfig();
      setActionMsg(t('common.success'));
      fetchConfig();
    } catch (e: any) {
      setActionMsg(e.message);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        icon={Settings2}
        title={t('system.title')}
        description={t('system.config')}
        actions={
          <>
            <Button variant="secondary" onClick={handleReload}>
              <RefreshCw size={16} /> {t('system.reload')}
            </Button>
            <Button variant="danger" onClick={handleRestart}>
              <RotateCcw size={16} /> {t('system.restart')}
            </Button>
          </>
        }
      />

      {actionMsg && (
        <div className="rounded-card bg-accent-wash px-4 py-2 text-sm text-accent-text ring-1 ring-accent/20">
          {actionMsg}
        </div>
      )}

      {/* Settings body keeps its own cards; the page title already names the section. */}
      <GlobalSettings hideHeader />

      {/* Raw config stays collapsed by default: it is a diagnostic view, not a daily action. */}
      <Card>
        <button
          type="button"
          onClick={() => setShowRaw(!showRaw)}
          aria-expanded={showRaw}
          className="flex w-full items-center gap-2 text-left"
        >
          {showRaw ? (
            <ChevronDown size={16} className="text-ink-mute" />
          ) : (
            <ChevronRight size={16} className="text-ink-mute" />
          )}
          <FileCode size={16} className="text-ink-mute" />
          <h3 className="text-sm font-semibold text-ink">{t('system.rawConfig', 'Raw Config')}</h3>
          <span className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[10px] uppercase text-ink-mute ring-1 ring-hairline">
            {format}
          </span>
        </button>
        {showRaw && (
          <div className="mt-3">
            {loading ? (
              <LoadingState label={t('common.loading')} />
            ) : (
              <pre className="max-h-[65vh] overflow-auto whitespace-pre rounded-control bg-surface-sunken p-4 font-mono text-xs leading-relaxed text-ink-soft ring-1 ring-hairline">
                {content || t('common.noData')}
              </pre>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
