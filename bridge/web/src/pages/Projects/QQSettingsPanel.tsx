import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Input } from '@/components/ui';
import { getQQSettings, saveQQSettings, type QQSettingsResponse } from '@/api/qq';

export default function QQSettingsPanel({ project }: { project: string }) {
  const { t } = useTranslation();
  const [data, setData] = useState<QQSettingsResponse | null>(null);
  const [token, setToken] = useState('');
  const [clearToken, setClearToken] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<'restart' | 'unchanged' | ''>('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setData(null); setError(''); setToken(''); setClearToken(false); setSaved('');
    getQQSettings(project).then(value => { if (active) setData(value); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : String(e)); });
    return () => { active = false; };
  }, [project]);

  const save = async () => {
    if (!data) return;
    setBusy(true); setError(''); setSaved('');
    const { ws_url, http_url, share_session_in_channel } = data.settings;
    try {
      const result = await saveQQSettings(project, { ws_url, http_url, share_session_in_channel, ...(clearToken ? { token: '' } : token ? { token } : {}) });
      setSaved(result.restart_required ? 'restart' : 'unchanged');
      setToken(''); setClearToken(false);
      if (result.settings) setData({ ...data, settings: result.settings });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return <Card className="space-y-4">
    <h3 className="text-sm font-semibold">{t('qq.settingsTitle')}</h3>
    <p className="text-sm text-gray-500">{t('qq.settingsHint')}</p>
    {error && <p role="alert" className="text-red-500">{error}</p>}
    {saved && <p role="status" className="text-green-600">{t(saved === 'restart' ? 'qq.savedRestart' : 'common.saved')}</p>}
    {data && <fieldset disabled={busy} className="space-y-4 max-w-lg">
      <Input label={t('fields.wsUrl')} aria-label={t('fields.wsUrl')} value={data.settings.ws_url}
        onChange={e => { setSaved(''); setData({ ...data, settings: { ...data.settings, ws_url: e.target.value } }); }} />
      <Input label={t('qq.httpURL')} aria-label={t('qq.httpURL')} value={data.settings.http_url}
        onChange={e => { setSaved(''); setData({ ...data, settings: { ...data.settings, http_url: e.target.value } }); }} />
      <Input type="password" autoComplete="new-password" label={t('fields.accessToken')} aria-label={t('fields.accessToken')} value={token} disabled={clearToken}
        placeholder={data.settings.token_set ? t('qq.keepToken') : ''} onChange={e => { setSaved(''); setToken(e.target.value); }} />
      {data.settings.token_set && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={clearToken}
        onChange={e => { setSaved(''); setClearToken(e.target.checked); }} />{t('qq.clearToken')}</label>}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={data.settings.share_session_in_channel}
        onChange={e => { setSaved(''); setData({ ...data, settings: { ...data.settings, share_session_in_channel: e.target.checked } }); }} />{t('fields.sharedGroupSession')}</label>
      <p className="text-xs text-gray-500">{t('qq.sharedHint')}</p>
      <Button loading={busy} onClick={save}>{t('common.save')}</Button>
    </fieldset>}
    {data?.capabilities.some(c => !c.available) && <div className="text-sm text-gray-500 space-y-1">
      <p>{t('qq.unavailable')}</p>
      {data.capabilities.filter(c => !c.available).map(c => <p key={c.key}>{t(`qq.capabilities.${c.key}`, c.reason)}</p>)}
    </div>}
  </Card>;
}
