import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Input } from '@/components/ui';
import { getQQSettings, saveQQSettings, type QQSettings, type QQSettingsResponse } from '@/api/qq';

/**
 * QQ (OneBot v11) connection settings plus the switches the adapter already honors
 * (#710 件 1). Every field here maps to a key the adapter reads in
 * platform/qq/qq.go:153-206; nothing is offered that the adapter ignores, and
 * allow_from stays read-only because PATCH /projects/{name} owns it.
 */
export default function QQSettingsPanel({ project }: { project: string }) {
  const { t } = useTranslation();
  const [data, setData] = useState<QQSettingsResponse | null>(null);
  const [token, setToken] = useState('');
  const [clearToken, setClearToken] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<'restart' | 'unchanged' | ''>('');
  const [busy, setBusy] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const value = await getQQSettings(project);
      setData(value);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [project]);

  useEffect(() => {
    setData(null); setToken(''); setClearToken(false); setSaved('');
    fetchData();
    // Other panels can save the same QQ entry (the project's access-control card);
    // without this the panel keeps showing what it read at mount (#710 件 1).
    const handler = () => { fetchData(); };
    window.addEventListener('cc:refresh', handler);
    return () => { window.removeEventListener('cc:refresh', handler); };
  }, [fetchData]);

  const edit = (patch: Partial<QQSettings>) => {
    setSaved('');
    setData(d => (d ? { ...d, settings: { ...d.settings, ...patch } } : d));
  };

  const save = async () => {
    if (!data) return;
    setBusy(true); setError(''); setSaved('');
    const s = data.settings;
    try {
      const result = await saveQQSettings(project, {
        ws_url: s.ws_url,
        http_url: s.http_url,
        share_session_in_channel: s.share_session_in_channel,
        split_bubbles: s.split_bubbles,
        allow_groups_with: s.allow_groups_with,
        command_allow_from: s.command_allow_from,
        save_images_dir: s.save_images_dir,
        allow_qzone: s.allow_qzone,
        allow_avatar: s.allow_avatar,
        ...(clearToken ? { token: '' } : token ? { token } : {}),
      });
      setSaved(result.restart_required ? 'restart' : 'unchanged');
      setToken(''); setClearToken(false);
      if (result.settings) setData({ ...data, settings: result.settings });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  return <Card className="space-y-4">
    <h3 className="text-sm font-semibold">{t('qq.settingsTitle')}</h3>
    <p className="text-sm text-gray-500">{t('qq.settingsHint')}</p>
    {error && <p role="alert" className="text-red-500">{error}</p>}
    {saved && <p role="status" className="text-green-600">{t(saved === 'restart' ? 'qq.savedRestart' : 'common.saved')}</p>}
    {data && <fieldset disabled={busy} className="space-y-6 max-w-lg">
      <section className="space-y-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('qq.connection')}</h4>
        <Input label={t('fields.wsUrl')} aria-label={t('fields.wsUrl')} value={data.settings.ws_url}
          onChange={e => edit({ ws_url: e.target.value })} />
        <Input label={t('qq.httpURL')} aria-label={t('qq.httpURL')} value={data.settings.http_url}
          onChange={e => edit({ http_url: e.target.value })} />
        <Input type="password" autoComplete="new-password" label={t('fields.accessToken')} aria-label={t('fields.accessToken')} value={token} disabled={clearToken}
          placeholder={data.settings.token_set ? t('qq.keepToken') : ''} onChange={e => { setSaved(''); setToken(e.target.value); }} />
        {data.settings.token_set && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={clearToken}
          onChange={e => { setSaved(''); setClearToken(e.target.checked); }} />{t('qq.clearToken')}</label>}
        <div className="space-y-1">
          <p className="text-sm font-medium text-ink-soft">{t('fields.allowFrom')}</p>
          <p className="text-sm" aria-label={t('qq.allowFromReadonly')}>{data.settings.allow_from || '—'}</p>
          <p className="text-xs text-gray-500">{t('qq.allowFromReadonly')}</p>
        </div>
      </section>

      <section className="space-y-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('qq.groupBehavior')}</h4>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={t('qq.splitBubbles')} checked={data.settings.split_bubbles}
          onChange={e => edit({ split_bubbles: e.target.checked })} />{t('qq.splitBubbles')}</label>
        <p className="text-xs text-gray-500">{t('qq.splitBubblesHint')}</p>
        <Input label={t('qq.allowGroupsWith')} aria-label={t('qq.allowGroupsWith')} value={data.settings.allow_groups_with}
          placeholder={t('qq.allowGroupsWithPlaceholder')} onChange={e => edit({ allow_groups_with: e.target.value })} />
        <p className="text-xs text-gray-500">{t('qq.allowGroupsWithHint')}</p>
        <Input label={t('qq.commandAllowFrom')} aria-label={t('qq.commandAllowFrom')} value={data.settings.command_allow_from}
          placeholder={t('qq.commandAllowFromPlaceholder')} onChange={e => edit({ command_allow_from: e.target.value })} />
        <p className="text-xs text-gray-500">{t('qq.commandAllowFromHint')}</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={t('fields.sharedGroupSession')} checked={data.settings.share_session_in_channel}
          onChange={e => edit({ share_session_in_channel: e.target.checked })} />{t('fields.sharedGroupSession')}</label>
        <p className="text-xs text-gray-500">{t('qq.sharedHint')}</p>
      </section>

      <section className="space-y-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('qq.contentSection')}</h4>
        <Input label={t('qq.saveImagesDir')} aria-label={t('qq.saveImagesDir')} value={data.settings.save_images_dir}
          placeholder={t('qq.saveImagesDirPlaceholder')} onChange={e => edit({ save_images_dir: e.target.value })} />
        <p className="text-xs text-gray-500">{t('qq.saveImagesDirHint')}</p>
      </section>

      <section className="space-y-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('qq.socialSection')}</h4>
        <p className="text-xs text-gray-500">{t('qq.socialHint')}</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={t('qq.allowQzone')} checked={data.settings.allow_qzone}
          onChange={e => edit({ allow_qzone: e.target.checked })} />{t('qq.allowQzone')}</label>
        <p className="text-xs text-gray-500">{t('qq.allowQzoneHint')}</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={t('qq.allowAvatar')} checked={data.settings.allow_avatar}
          onChange={e => edit({ allow_avatar: e.target.checked })} />{t('qq.allowAvatar')}</label>
        <p className="text-xs text-gray-500">{t('qq.allowAvatarHint')}</p>
      </section>

      <Button loading={busy} onClick={save}>{t('common.save')}</Button>
    </fieldset>}
  </Card>;
}