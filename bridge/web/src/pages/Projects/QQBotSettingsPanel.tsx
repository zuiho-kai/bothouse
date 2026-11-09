import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Input } from '@/components/ui';
import { getQQBotSettings, saveQQBotSettings, type QQBotSettings, type QQBotSettingsResponse } from '@/api/qqbot';

/**
 * Official QQ Bot settings (platform type "qqbot"), #710 件 5.
 *
 * A separate panel from QQSettingsPanel on purpose: the two platforms share no
 * option — this one has app_id / app_secret / sandbox / markdown_support, the
 * OneBot bridge has ws_url / token / share_session_in_channel. Neither
 * credential is echoed (the API returns app_id_set / app_secret_set only), and a
 * blank secret field keeps the stored one, because the form cannot prefill it.
 */
export default function QQBotSettingsPanel({ project }: { project: string }) {
  const { t } = useTranslation();
  const [data, setData] = useState<QQBotSettingsResponse | null>(null);
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<'restart' | 'unchanged' | ''>('');
  const [busy, setBusy] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const value = await getQQBotSettings(project);
      setData(value);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [project]);

  useEffect(() => {
    setData(null); setSecret(''); setSaved('');
    fetchData();
    // The platform access-control card saves allow_from elsewhere; re-read so this
    // panel does not keep showing what it read at mount.
    const handler = () => { fetchData(); };
    window.addEventListener('cc:refresh', handler);
    return () => { window.removeEventListener('cc:refresh', handler); };
  }, [fetchData]);

  const edit = (patch: Partial<QQBotSettings>) => {
    setSaved('');
    setData(d => (d ? { ...d, settings: { ...d.settings, ...patch } } : d));
  };

  const save = async () => {
    if (!data) return;
    setBusy(true); setError(''); setSaved('');
    const s = data.settings;
    try {
      const result = await saveQQBotSettings(project, {
        sandbox: s.sandbox,
        share_session_in_channel: s.share_session_in_channel,
        markdown_support: s.markdown_support,
        // blank = untouched: the stored secret stays, the API has no way to show it
        ...(secret ? { app_secret: secret } : {}),
      });
      setSaved(result.restart_required ? 'restart' : 'unchanged');
      setSecret('');
      if (result.settings) setData({ ...data, settings: result.settings });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  // The wrapper only carries the test id: Card does not forward extra attributes
  // (PersonaPanel's data-testid is dropped the same way).
  return <div data-testid="qqbot-panel"><Card className="space-y-4">
    <h3 className="text-sm font-semibold">{t('qqbot.title')}</h3>
    <p className="text-sm text-gray-500">{t('qqbot.hint')}</p>
    {error && <p role="alert" className="text-red-500">{error}</p>}
    {saved && <p role="status" className="text-green-600">{t(saved === 'restart' ? 'qq.savedRestart' : 'common.saved')}</p>}
    {data && <fieldset disabled={busy} className="space-y-6 max-w-lg">
      <section className="space-y-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('qqbot.credentials')}</h4>
        <div className="space-y-1">
          <p className="text-sm font-medium text-ink-soft">{t('fields.appId')}</p>
          <p className="text-sm" aria-label={t('qqbot.appIDSet')}>
            {data.settings.app_id_set ? t('qqbot.stored') : t('qqbot.missing')}
          </p>
          <p className="text-xs text-gray-500">{t('qqbot.appIDReadonly')}</p>
        </div>
        <Input type="password" autoComplete="new-password" label={t('fields.appSecret')} aria-label={t('fields.appSecret')} value={secret}
          placeholder={data.settings.app_secret_set ? t('qqbot.keepSecret') : ''} onChange={e => { setSaved(''); setSecret(e.target.value.trim()); }} />
        <p className="text-xs text-gray-500">{t('qqbot.secretHint')}</p>
        <div className="space-y-1">
          <p className="text-sm font-medium text-ink-soft">{t('fields.allowFrom')}</p>
          <p className="text-sm" aria-label={t('qq.allowFromReadonly')}>{data.settings.allow_from || '—'}</p>
          <p className="text-xs text-gray-500">{t('qq.allowFromReadonly')}</p>
        </div>
      </section>

      <section className="space-y-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('qqbot.behavior')}</h4>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={t('fields.sandboxMode')} checked={data.settings.sandbox}
          onChange={e => edit({ sandbox: e.target.checked })} />{t('fields.sandboxMode')}</label>
        <p className="text-xs text-gray-500">{t('qqbot.sandboxHint')}</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={t('qqbot.markdown')} checked={data.settings.markdown_support}
          onChange={e => edit({ markdown_support: e.target.checked })} />{t('qqbot.markdown')}</label>
        <p className="text-xs text-gray-500">{t('qqbot.markdownHint')}</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={t('fields.sharedGroupSession')} checked={data.settings.share_session_in_channel}
          onChange={e => edit({ share_session_in_channel: e.target.checked })} />{t('fields.sharedGroupSession')}</label>
        <p className="text-xs text-gray-500">{t('qqbot.sharedHint')}</p>
      </section>

      <Button loading={busy} onClick={save}>{t('common.save')}</Button>
    </fieldset>}
  </Card></div>;
}