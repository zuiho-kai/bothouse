import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { addPlatformToProject, listProjects, shownName, type ProjectSummary } from '@/api/projects';
import { restartSystem } from '@/api/status';
import { Button, Modal } from '@/components/ui';
import type { GeneralMember } from '@/api/general';

export default function GeneralMembership({ members, onRefresh }: {
  members: GeneralMember[];
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>();
  const [selected, setSelected] = useState('');
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<string[]>([]);
  const [restarting, setRestarting] = useState(false);
  const [restartRequested, setRestartRequested] = useState(false);
  const [restartError, setRestartError] = useState(false);
  const online = new Set(members.map(({ project }) => project));
  const awaitingRestart = pending.some((project) => !online.has(project));
  const choices = projects?.filter((project) =>
    !project.platforms.includes('general') && !online.has(project.name) && !pending.includes(project.name),
  ).sort((a, b) => shownName(a).localeCompare(shownName(b)));

  useEffect(() => {
    if (!open) return;
    let active = true;
    listProjects().then(
      ({ projects }) => { if (active) setProjects(projects); },
      () => { if (active) setLoadError(true); },
    );
    return () => { active = false; };
  }, [open]);

  async function addProject() {
    if (!selected || saving) return;
    setSaving(true);
    setSaveError(false);
    try {
      const result = await addPlatformToProject(selected, { type: 'general', options: {} });
      if (result.restart_required) {
        setPending((current) => [...current, selected]);
        setRestartRequested(false);
        setRestartError(false);
      } else {
        onRefresh();
      }
      setOpen(false);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  async function restart() {
    if (!window.confirm(t('system.restartConfirm'))) return;
    setRestartError(false);
    setRestarting(true);
    try {
      await restartSystem();
      setRestartRequested(true);
    } catch {
      setRestartError(true);
    } finally {
      setRestarting(false);
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Button type="button" variant="secondary" size="sm" aria-haspopup="dialog" onClick={() => {
        setProjects(undefined);
        setSelected('');
        setLoadError(false);
        setSaveError(false);
        setOpen(true);
      }}>
        <Plus size={14} aria-hidden /> {t('general.addProject')}
      </Button>
      {awaitingRestart && (
        <>
          <p className="text-xs text-ink-soft" role="status">
            {t(restartRequested ? 'general.restartRequested' : 'general.projectSaved')}
          </p>
          {restartRequested ? (
            <Button type="button" variant="ghost" size="sm" onClick={onRefresh}>{t('general.reloadRoom')}</Button>
          ) : (
            <Button type="button" variant="ghost" size="sm" loading={restarting} onClick={() => void restart()}>
              {t('setup.restartNow')}
            </Button>
          )}
          {restartError && <p role="alert" className="text-xs text-red-700 dark:text-red-400">{t('general.restartError')}</p>}
        </>
      )}
      <Modal open={open} onClose={() => { if (!saving) setOpen(false); }} title={t('general.addProject')}>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void addProject(); }}>
          {loadError ? (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">{t('general.projectsError')}</p>
          ) : !choices ? (
            <p role="status" className="text-sm text-ink-soft">{t('common.loading')}</p>
          ) : choices.length === 0 ? (
            <p className="text-sm text-ink-soft">{t('general.noEligibleProjects')}</p>
          ) : (
            <label className="block space-y-1.5 text-sm font-medium">
              <span>{t('general.chooseProject')}</span>
              <select value={selected} onChange={(event) => setSelected(event.target.value)} disabled={saving}
                className="h-10 w-full rounded-control border border-hairline bg-surface px-3 text-ink">
                <option value="" disabled>{t('general.chooseProject')}</option>
                {choices.map((project) => <option key={project.name} value={project.name}>{shownName(project)}</option>)}
              </select>
            </label>
          )}
          {saveError && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{t('general.addProjectError')}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={saving} onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            {choices && choices.length > 0 && (
              <Button type="submit" disabled={!selected} loading={saving}>{t('general.addProject')}</Button>
            )}
          </div>
        </form>
      </Modal>
    </div>
  );
}
