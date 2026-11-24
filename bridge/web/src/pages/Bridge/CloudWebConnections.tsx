import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Plus } from 'lucide-react';
import {
  createCloudWebConnection, listCloudWebConnections, removeCloudWebConnection, updateCloudWebConnection,
  type CloudWebConnection,
} from '@/api/cloudWebConnections';
import { Button, EmptyState, Input, LoadingState, Modal, Section } from '@/components/ui';
import { errorMessage } from '@/components/DSHNotice';

type ConnectionForm = CloudWebConnection & { token: string };

export default function CloudWebConnections() {
  const { t } = useTranslation();
  const [connections, setConnections] = useState<CloudWebConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState<ConnectionForm | null>(null);
  const [removing, setRemoving] = useState<CloudWebConnection | null>(null);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState('');

  const load = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const result = await listCloudWebConnections();
      setConnections(result.connections);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const openForm = (connection?: CloudWebConnection) => {
    setActionError('');
    setForm({ id: '', name: '', url: '', ...connection, token: '' });
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form) return;
    setPending(true);
    setActionError('');
    try {
      const input = { name: form.name, url: form.url, token: form.token || undefined };
      const saved = form.id ? await updateCloudWebConnection(form.id, input) : await createCloudWebConnection(input);
      setConnections(items => form.id ? items.map(item => item.id === saved.id ? saved : item) : [...items, saved]);
      setForm(null);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  const remove = async () => {
    if (!removing) return;
    setPending(true);
    setActionError('');
    try {
      await removeCloudWebConnection(removing.id);
      setConnections(items => items.filter(item => item.id !== removing.id));
      setRemoving(null);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Section
      title={t('cloudWebConnections.title')}
      description={t('cloudWebConnections.description')}
      actions={<Button size="sm" disabled={loading || !!loadError} onClick={() => openForm()}>
        <Plus size={14} aria-hidden /> {t('cloudWebConnections.add')}
      </Button>}
    >
      {loading ? <LoadingState label={t('common.loading')} /> : loadError ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
          <Button size="sm" variant="secondary" onClick={load}>{t('bridge.retry')}</Button>
        </div>
      ) : connections.length ? (
        <ul className="divide-y divide-hairline">
          {connections.map(connection => (
            <li key={connection.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="break-words text-sm font-medium text-ink">{connection.name}</p>
                <p className="break-all text-xs text-ink-mute">{connection.url}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => openForm(connection)}>{t('cloudWebConnections.edit')}</Button>
                <Button size="sm" variant="danger" onClick={() => { setActionError(''); setRemoving(connection); }}>
                  {t('cloudWebConnections.removeAction')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : <EmptyState icon={Globe} message={t('cloudWebConnections.empty')} />}

      <Modal open={!!form} onClose={() => { if (!pending) setForm(null); }}
        title={t(form?.id ? 'cloudWebConnections.edit' : 'cloudWebConnections.add')}>
        {form && <form onSubmit={save} className="space-y-4 py-2">
          <Input label={t('cloudWebConnections.name')} aria-label={t('cloudWebConnections.name')}
            value={form.name} required onChange={event => setForm({ ...form, name: event.target.value })} />
          <Input label={t('cloudWebConnections.url')} aria-label={t('cloudWebConnections.url')}
            value={form.url} placeholder="https://hub.example.com" required
            onChange={event => setForm({ ...form, url: event.target.value })} />
          <Input label={t('fields.botToken')} aria-label={t('fields.botToken')} type="password" autoComplete="new-password"
            value={form.token} required={!form.id} placeholder={form.id ? t('cloudWebConnections.keepToken') : undefined}
            onChange={event => setForm({ ...form, token: event.target.value })} />
          {form.id && <p className="text-sm text-ink-soft">{t('cloudWebConnections.futureUse')}</p>}
          {actionError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{actionError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" type="button" disabled={pending} onClick={() => setForm(null)}>{t('common.cancel')}</Button>
            <Button type="submit" loading={pending}>{t('common.save')}</Button>
          </div>
        </form>}
      </Modal>

      <Modal open={!!removing} onClose={() => { if (!pending) setRemoving(null); }} title={t('cloudWebConnections.remove')}>
        <div className="space-y-4 py-2">
          <p className="text-sm text-ink-soft">{t('cloudWebConnections.removeConfirm', { name: removing?.name })}</p>
          {actionError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{actionError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={pending} onClick={() => setRemoving(null)}>{t('common.cancel')}</Button>
            <Button variant="danger" loading={pending} onClick={remove}>{t('cloudWebConnections.removeAction')}</Button>
          </div>
        </div>
      </Modal>
    </Section>
  );
}
