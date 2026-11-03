import { useEffect, useState, useCallback } from 'react';
import AutostartSettingCard from '@/components/Autostart/AutostartSettingCard';
import { useTranslation } from 'react-i18next';
import { Save } from 'lucide-react';
import { Card, Button, LoadingState, PageHeader } from '@/components/ui';
import { getGlobalSettings, updateGlobalSettings, type GlobalSettings as GS } from '@/api/settings';
import { cn } from '@/lib/utils';
import ThemeSettingCard from '@/components/Theme/ThemeSettingCard';
import TokenUnitSettingCard from '@/components/Usage/TokenUnitSettingCard';

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];
const ATTACHMENT_OPTS = ['', 'on', 'off'];
const LANGUAGES = ['en', 'zh', 'zh-TW', 'ja', 'ko', 'es'];

function Toggle({ value, onChange, label, hint }: { value: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <label className="text-sm font-medium text-ink-soft">{label}</label>
        {hint && <p className="mt-0.5 text-[11px] text-ink-mute">{hint}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        className={cn(
          'h-6 w-10 shrink-0 rounded-pill transition-colors duration-base ease-ui-standard',
          value ? 'bg-accent' : 'bg-hairline-strong',
        )}
      >
        <span className={cn('mx-1 block h-4 w-4 rounded-full bg-surface shadow-sm transition-transform duration-base ease-ui-out', value ? 'translate-x-4' : 'translate-x-0')} />
      </button>
    </div>
  );
}

function Select({ value, onChange, label, options, hint }: { value: string; onChange: (v: string) => void; label: string; options: { value: string; label: string }[]; hint?: string }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-ink-soft">{label}</label>
      {hint && <p className="mb-1.5 text-[11px] text-ink-mute">{hint}</p>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-control bg-surface px-3 py-2 text-sm text-ink ring-1 ring-hairline transition-[box-shadow,background-color] duration-base ease-ui-out hover:ring-hairline-strong focus:outline-none focus:ring-2 focus:ring-accent-text focus:ring-offset-2 focus:ring-offset-canvas"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function NumberInput({ value, onChange, label, hint, min, max }: { value: number; onChange: (v: number) => void; label: string; hint?: string; min?: number; max?: number }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-ink-soft">{label}</label>
      {hint && <p className="mb-1.5 text-[11px] text-ink-mute">{hint}</p>}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
        className="w-full rounded-control bg-surface px-3 py-2 text-sm tabular-nums text-ink ring-1 ring-hairline transition-[box-shadow,background-color] duration-base ease-ui-out hover:ring-hairline-strong focus:outline-none focus:ring-2 focus:ring-accent-text focus:ring-offset-2 focus:ring-offset-canvas"
      />
    </div>
  );
}

export default function GlobalSettings({ hideHeader }: { hideHeader?: boolean } = {}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const [language, setLanguage] = useState('en');
  const [attachmentSend, setAttachmentSend] = useState('');
  const [logLevel, setLogLevel] = useState('info');
  const [idleTimeout, setIdleTimeout] = useState(120);
  const [thinkingMessages, setThinkingMessages] = useState(true);
  const [thinkingMaxLen, setThinkingMaxLen] = useState(300);
  const [toolMessages, setToolMessages] = useState(true);
  const [toolMaxLen, setToolMaxLen] = useState(500);
  const [spEnabled, setSpEnabled] = useState(true);
  const [spInterval, setSpInterval] = useState(1500);
  const [rlMax, setRlMax] = useState(20);
  const [rlWindow, setRlWindow] = useState(60);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await getGlobalSettings();
      setLanguage(s.language || 'en');
      setAttachmentSend(s.attachment_send || '');
      setLogLevel(s.log_level || 'info');
      setIdleTimeout(s.idle_timeout_mins ?? 120);
      setThinkingMessages(s.thinking_messages ?? true);
      setThinkingMaxLen(s.thinking_max_len ?? 300);
      setToolMessages(s.tool_messages ?? true);
      setToolMaxLen(s.tool_max_len ?? 500);
      setSpEnabled(s.stream_preview_enabled ?? true);
      setSpInterval(s.stream_preview_interval_ms ?? 1500);
      setRlMax(s.rate_limit_max_messages ?? 20);
      setRlWindow(s.rate_limit_window_secs ?? 60);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    setSaving(true);
    setMsg('');
    try {
      await updateGlobalSettings({
        language,
        attachment_send: attachmentSend,
        log_level: logLevel,
        idle_timeout_mins: idleTimeout,
        thinking_messages: thinkingMessages,
        thinking_max_len: thinkingMaxLen,
        tool_messages: toolMessages,
        tool_max_len: toolMaxLen,
        stream_preview_enabled: spEnabled,
        stream_preview_interval_ms: spInterval,
        rate_limit_max_messages: rlMax,
        rate_limit_window_secs: rlWindow,
      });
      setMsg(t('common.success'));
      setTimeout(() => setMsg(''), 3000);
    } catch (e: any) {
      setMsg(e.message || 'Error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-5">
        <LoadingState label={t('common.loading', 'Loading...')} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {!hideHeader && <PageHeader icon={Save} title={t('settings.title', '全局设置')} />}
      <ThemeSettingCard />
      <TokenUnitSettingCard />
      {/* General */}
      <Card>
        <h3 className="mb-4 text-sm font-semibold text-ink">{t('settings.general', 'General')}</h3>
        <div className="space-y-4 max-w-lg">
          <Select
            label={t('settings.language', 'Language')}
            value={language}
            onChange={setLanguage}
            options={LANGUAGES.map((l) => ({ value: l, label: l }))}
          />
          <Select
            label={t('settings.attachmentSend', 'Attachment send')}
            value={attachmentSend}
            onChange={setAttachmentSend}
            hint={t('settings.attachmentSendHint', 'Send file/image attachments back to platform')}
            options={ATTACHMENT_OPTS.map((v) => ({ value: v, label: v || t('settings.default', 'default') }))}
          />
          <NumberInput
            label={t('settings.idleTimeout', 'Idle timeout (min)')}
            value={idleTimeout}
            onChange={setIdleTimeout}
            min={0}
            hint={t('settings.idleTimeoutHint', 'Auto-stop agent after N minutes of inactivity; 0 = disabled')}
          />
        </div>
      </Card>

      {/* Display */}
      <Card>
        <h3 className="mb-4 text-sm font-semibold text-ink">{t('settings.display', 'Display')}</h3>
        <div className="space-y-4 max-w-lg">
          <Toggle
            label={t('settings.thinkingMessages', 'Thinking messages')}
            value={thinkingMessages}
            onChange={setThinkingMessages}
            hint={t('settings.thinkingMessagesHint', 'Show or hide intermediate thinking messages')}
          />
          <NumberInput
            label={t('settings.thinkingMaxLen', 'Thinking max length')}
            value={thinkingMaxLen}
            onChange={setThinkingMaxLen}
            min={0}
            hint={t('settings.thinkingMaxLenHint', 'Max characters for thinking messages; 0 = no truncation')}
          />
          <Toggle
            label={t('settings.toolMessages', 'Tool progress')}
            value={toolMessages}
            onChange={setToolMessages}
            hint={t('settings.toolMessagesHint', 'Show or hide tool progress messages')}
          />
          <NumberInput
            label={t('settings.toolMaxLen', 'Tool max length')}
            value={toolMaxLen}
            onChange={setToolMaxLen}
            min={0}
            hint={t('settings.toolMaxLenHint', 'Max characters for tool use messages; 0 = no truncation')}
          />
        </div>
      </Card>

      {/* Stream preview */}
      <Card>
        <h3 className="mb-4 text-sm font-semibold text-ink">{t('settings.streamPreview', 'Stream preview')}</h3>
        <div className="space-y-4 max-w-lg">
          <Toggle label={t('settings.streamPreviewEnabled', 'Enable')} value={spEnabled} onChange={setSpEnabled} hint={t('settings.streamPreviewEnabledHint', 'Show real-time streaming updates in IM')} />
          <NumberInput
            label={t('settings.streamPreviewInterval', 'Interval (ms)')}
            value={spInterval}
            onChange={setSpInterval}
            min={100}
            hint={t('settings.streamPreviewIntervalHint', 'Minimum milliseconds between preview updates')}
          />
        </div>
      </Card>

      {/* Rate limit */}
      <Card>
        <h3 className="mb-4 text-sm font-semibold text-ink">{t('settings.rateLimit', 'Rate limit')}</h3>
        <div className="space-y-4 max-w-lg">
          <NumberInput
            label={t('settings.rlMaxMessages', 'Max messages')}
            value={rlMax}
            onChange={setRlMax}
            min={0}
            hint={t('settings.rlMaxMessagesHint', 'Max messages per window; 0 = disabled')}
          />
          <NumberInput
            label={t('settings.rlWindowSecs', 'Window (sec)')}
            value={rlWindow}
            onChange={setRlWindow}
            min={1}
            hint={t('settings.rlWindowSecsHint', 'Time window in seconds')}
          />
        </div>
      </Card>

      {/* Log */}
      <Card>
        <h3 className="mb-4 text-sm font-semibold text-ink">{t('settings.log', 'Log')}</h3>
        <div className="space-y-4 max-w-lg">
          <Select
            label={t('settings.logLevel', 'Log level')}
            value={logLevel}
            onChange={setLogLevel}
            options={LOG_LEVELS.map((l) => ({ value: l, label: l }))}
          />
        </div>
      </Card>

      <AutostartSettingCard />

      {/* Save */}
      {/* Save bar stays inside the scroll area as a sticky footer so a long settings list never
          hides the only action on the page (mobile especially). */}
      <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 rounded-card bg-surface/92 px-4 py-3 shadow-ui-2 backdrop-blur-md">
        <Button loading={saving} onClick={handleSave}>
          <Save size={16} /> {t('common.save')}
        </Button>
        {msg && (
          <p className={cn('text-sm', msg === t('common.success') ? 'text-accent-text' : 'text-red-600 dark:text-red-400')}>{msg}</p>
        )}
      </div>
    </div>
  );
}
