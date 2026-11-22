import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { attachDSHProject, listDSHProjectRooms, type DSHProjectRoom } from '@/api/dsh';
import { errorMessage } from '@/components/DSHNotice';
import { Button } from '@/components/ui';
import { DSHSetupForm } from './DSHSetupForm';

interface Props {
  projectName: string;
  onComplete: (restartRequired: boolean) => void;
  onCancel: () => void;
}

export function DSHLocalPlatformForm({ projectName, onComplete, onCancel }: Props) {
  const { t } = useTranslation();
  const [rooms, setRooms] = useState<DSHProjectRoom[] | null>(null);
  const [roomId, setRoomId] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [loadError, setLoadError] = useState('');
  const unavailable = t('dshProject.unavailable');

  useEffect(() => {
    let active = true;
    listDSHProjectRooms().then(({ rooms }) => {
      if (!active) return;
      setRooms(rooms);
      const general = rooms.find(room => room.name.toLowerCase() === 'general');
      setRoomId(general ? String(general.id) : '');
    }).catch(error => {
      if (active) setLoadError(error instanceof SyntaxError ? unavailable : errorMessage(error));
    });
    return () => { active = false; };
  }, [attempt, unavailable]);

  const reload = () => {
    setRooms(null);
    setRoomId('');
    setLoadError('');
    setAttempt(value => value + 1);
  };

  const connect = async () => {
    const result = await attachDSHProject(projectName, Number(roomId));
    onComplete(result.restart_required);
  };

  return (
    <DSHSetupForm
      className="py-2"
      onCancel={onCancel}
      cancelLabel={t('common.back')}
      submit={rooms?.length ? { run: connect, label: t('dshProject.connect'), disabled: !roomId } : undefined}
      secondaryAction={(loadError || rooms?.length === 0) && <Button type="button" onClick={reload}>{t('setup.retry')}</Button>}
    >
      {loadError && <p role="alert" className="text-sm text-red-600">{loadError}</p>}
      {!rooms && !loadError && <p role="status" className="text-sm text-ink-soft">{t('common.loading')}</p>}
      {rooms?.length === 0 && <p role="status" className="text-sm text-ink-soft">{t('dshProject.noRooms')}</p>}
      {!!rooms?.length && (
        <label className="block space-y-1 text-sm text-ink-soft">
          {t('dshProject.room')}
          <select
            className="block w-full rounded-control border border-hairline bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent-text disabled:opacity-60"
            required
            value={roomId}
            onChange={event => setRoomId(event.target.value)}
          >
            <option value="" disabled>{t('dshProject.chooseRoom')}</option>
            {rooms.map(room => <option key={room.id} value={room.id}>#{room.name}</option>)}
          </select>
        </label>
      )}
    </DSHSetupForm>
  );
}
