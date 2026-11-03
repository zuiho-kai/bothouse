import { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Clock, Play, Plus, Trash2, Terminal, MessageSquare, Power,
  ChevronDown,
} from 'lucide-react';
import { Button, Badge, Modal, Input, Textarea, EmptyState, PageHeader, LoadingState } from '@/components/ui';
import { listCronJobs, createCronJob, updateCronJob, deleteCronJob, triggerCronJob, type CronJob } from '@/api/cron';
import { listProjects, shownName, shownNames, type ProjectSummary } from '@/api/projects';
import { listSessions, type Session } from '@/api/sessions';
import { formatTime, cn } from '@/lib/utils';

const MODE_OPTIONS = ['bypassPermissions', 'acceptEdits', 'auto', 'plan', 'dontAsk'] as const;

/* ── Cron presets ── */
interface CronPreset {
  label: string;
  labelZh: string;
  expr: string;
}

const PRESETS: CronPreset[] = [
  { label: 'Every minute',  labelZh: '每分钟',     expr: '* * * * *'    },
  { label: 'Every 5 min',   labelZh: '每 5 分钟',  expr: '*/5 * * * *'  },
  { label: 'Every 15 min',  labelZh: '每 15 分钟', expr: '*/15 * * * *' },
  { label: 'Every 30 min',  labelZh: '每 30 分钟', expr: '*/30 * * * *' },
  { label: 'Every hour',    labelZh: '每小时',     expr: '0 * * * *'    },
  { label: 'Every 2 hours', labelZh: '每 2 小时',  expr: '0 */2 * * *'  },
  { label: 'Every 6 hours', labelZh: '每 6 小时',  expr: '0 */6 * * *'  },
  { label: 'Daily 6:00',    labelZh: '每天 6:00',  expr: '0 6 * * *'    },
  { label: 'Daily 9:00',    labelZh: '每天 9:00',  expr: '0 9 * * *'    },
  { label: 'Daily 12:00',   labelZh: '每天 12:00', expr: '0 12 * * *'   },
  { label: 'Daily 18:00',   labelZh: '每天 18:00', expr: '0 18 * * *'   },
  { label: 'Daily 22:00',   labelZh: '每天 22:00', expr: '0 22 * * *'   },
  { label: 'Weekdays 9:00', labelZh: '工作日 9:00',expr: '0 9 * * 1-5'  },
  { label: 'Weekly Mon 9AM',labelZh: '每周一 9:00',expr: '0 9 * * 1'    },
  { label: 'Monthly 1st',   labelZh: '每月 1 号',  expr: '0 0 1 * *'    },
];

function describeCron(expr: string): string {
  const preset = PRESETS.find(p => p.expr === expr);
  if (preset) return preset.labelZh;
  return expr;
}

/* ── Cron Schedule Picker (dropdown + custom input) ── */
const CUSTOM_VALUE = '__custom__';

function CronPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh');
  const isPreset = PRESETS.some(p => p.expr === value);
  const [custom, setCustom] = useState(!isPreset && !!value);

  const selectValue = custom ? CUSTOM_VALUE : value;

  const handleSelect = (v: string) => {
    if (v === CUSTOM_VALUE) {
      setCustom(true);
    } else {
      setCustom(false);
      onChange(v);
    }
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <select
          value={selectValue}
          onChange={e => handleSelect(e.target.value)}
          className={cn(
            'w-full appearance-none rounded-control px-3 py-2 pr-8 text-sm',
            'bg-surface text-ink ring-1 ring-hairline hover:ring-hairline-strong',
            'transition-[box-shadow,background-color] duration-base ease-ui-out',
            'focus:outline-none focus:ring-2 focus:ring-accent-text focus:ring-offset-2 focus:ring-offset-canvas',
          )}
        >
          <option value="" disabled>{isZh ? '选择执行频率' : 'Select schedule'}</option>
          {PRESETS.map(p => (
            <option key={p.expr} value={p.expr}>
              {isZh ? p.labelZh : p.label} ({p.expr})
            </option>
          ))}
          <option value={CUSTOM_VALUE}>{isZh ? '✏ 自定义表达式' : '✏ Custom expression'}</option>
        </select>
        <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-mute" />
      </div>
      {custom && (
        <Input
          placeholder="0 9 * * 1-5"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="font-mono text-xs"
        />
      )}
    </div>
  );
}

/* ── Select dropdown ── */
function Select({ label, value, onChange, options, placeholder }: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      {label && <label className="block text-sm font-medium text-ink-soft">{label}</label>}
      <div className="relative">
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className={cn(
            'w-full appearance-none rounded-control px-3 py-2 pr-8 text-sm',
            'bg-surface text-ink ring-1 ring-hairline hover:ring-hairline-strong',
            'transition-[box-shadow,background-color] duration-base ease-ui-out',
            'focus:outline-none focus:ring-2 focus:ring-accent-text focus:ring-offset-2 focus:ring-offset-canvas',
          )}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-mute" />
      </div>
    </div>
  );
}

/* ── Toggle ── */
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full transition-colors duration-base ease-ui-standard',
          checked ? 'bg-accent' : 'bg-hairline-strong',
        )}
      >
        <span className={cn(
          'mt-[3px] block h-3.5 w-3.5 rounded-full bg-surface shadow-sm transition-transform duration-base ease-ui-out',
          checked ? 'translate-x-[18px]' : 'translate-x-[3px]',
        )} />
      </button>
      {label && <span className="text-sm text-ink-soft">{label}</span>}
    </label>
  );
}

/* ── Job form type ── */
interface JobForm {
  project: string;
  session_key: string;
  cron_expr: string;
  prompt: string;
  exec: string;
  description: string;
  silent: boolean;
  enabled: boolean;
  mode: string;
  _type: 'prompt' | 'exec';
}

const emptyForm: JobForm = {
  project: '', session_key: '', cron_expr: '', prompt: '', exec: '',
  description: '', silent: false, enabled: true, mode: '', _type: 'prompt',
};

/* ── Main page ── */
export default function CronList() {
  const { t } = useTranslation();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const [editJob, setEditJob] = useState<CronJob | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<JobForm>({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);
  const [sessionKeys, setSessionKeys] = useState<string[]>([]);

  const isEdit = !!editJob;

  const projectOptions = useMemo(
    () => projects.map(p => ({ value: p.name, label: shownName(p) })),
    [projects],
  );

  useEffect(() => {
    if (!form.project) { setSessionKeys([]); return; }
    let cancelled = false;
    listSessions(form.project).then(data => {
      if (cancelled) return;
      const keys = new Set<string>();
      for (const s of data.sessions || []) {
        if (s.session_key) keys.add(s.session_key);
      }
      setSessionKeys([...keys]);
    }).catch(() => { if (!cancelled) setSessionKeys([]); });
    return () => { cancelled = true; };
  }, [form.project]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [cronData, projData] = await Promise.all([listCronJobs(), listProjects()]);
      setJobs(cronData.jobs || []);
      setProjects(projData.projects || []);
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

  const openAdd = () => {
    setEditJob(null);
    setForm({ ...emptyForm });
    setShowForm(true);
  };

  const openEdit = (job: CronJob) => {
    setEditJob(job);
    setForm({
      project: job.project,
      session_key: job.session_key,
      cron_expr: job.cron_expr,
      prompt: job.prompt,
      exec: job.exec,
      description: job.description,
      silent: !!job.silent,
      enabled: job.enabled,
      mode: job.mode || '',
      _type: job.exec ? 'exec' : 'prompt',
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    setSaving(true);
    const activePrompt = form._type === 'prompt' ? form.prompt : '';
    const activeExec   = form._type === 'exec'   ? form.exec   : '';
    try {
      if (isEdit && editJob) {
        const updates: Record<string, any> = {};
        if (form.cron_expr !== editJob.cron_expr) updates.cron_expr = form.cron_expr;
        if (form.description !== editJob.description) updates.description = form.description;
        if (activePrompt !== editJob.prompt) updates.prompt = activePrompt;
        if (activeExec !== editJob.exec) updates.exec = activeExec;
        if (form.project !== editJob.project) updates.project = form.project;
        if (form.session_key !== editJob.session_key) updates.session_key = form.session_key;
        if (form.silent !== !!editJob.silent) updates.silent = form.silent;
        if (form.enabled !== editJob.enabled) updates.enabled = form.enabled;
        if ((form.mode || '') !== (editJob.mode || '')) updates.mode = form.mode;
        if (Object.keys(updates).length > 0) {
          await updateCronJob(editJob.id, updates);
        }
      } else {
        const body: any = { ...form, prompt: activePrompt, exec: activeExec };
        delete body._type;
        if (!body.prompt) delete body.prompt;
        if (!body.exec) delete body.exec;
        await createCronJob(body);
      }
      setShowForm(false);
      fetchData();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('common.confirmDelete'))) return;
    await deleteCronJob(id);
    fetchData();
  };

  const handleToggleEnabled = async (job: CronJob) => {
    try {
      await updateCronJob(job.id, { enabled: !job.enabled });
      fetchData();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleTrigger = async (job: CronJob) => {
    setTriggeringId(job.id);
    try {
      await triggerCronJob(job.id);
      alert(t('cron.triggerPending'));
      fetchData();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setTriggeringId(null);
    }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        icon={Clock}
        title={t('cron.title')}
        description={t('cron.schedule')}
        actions={
          <Button onClick={openAdd}>
            <Plus size={16} /> {t('cron.add')}
          </Button>
        }
      />

      {loading && jobs.length === 0 ? (
        <LoadingState label={t('common.loading')} />
      ) : jobs.length === 0 ? (
        <EmptyState message={t('cron.noJobs')} icon={Clock} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {jobs.map(job => (
            <div
              key={job.id}
              onClick={() => openEdit(job)}
              className={cn(
                'group relative cursor-pointer rounded-card bg-surface p-4 shadow-ui-1 transition-[box-shadow,transform,border-color,opacity] duration-state ease-ui-standard',
                job.enabled
                  ? 'hover:-translate-y-0.5 hover:shadow-ui-2'
                  : 'opacity-60 hover:opacity-85 ring-1 ring-hairline',
              )}
            >
              {/* Header */}
              <div className="mb-2 flex items-center gap-2 pr-16">
                {job.prompt ? (
                  <MessageSquare size={14} className="shrink-0 text-accent-text" />
                ) : (
                  <Terminal size={14} className="shrink-0 text-amber-600 dark:text-amber-400" />
                )}
                <span className="truncate text-sm font-medium text-ink">
                  {job.description || job.id}
                </span>
              </div>

              {/* Schedule badge + mode badge */}
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-control bg-accent-wash px-2 py-0.5 font-mono text-[11px] text-accent-text ring-1 ring-accent/20">
                  <Clock size={10} />
                  {describeCron(job.cron_expr)}
                </span>
                {job.silent && <Badge variant="outline" className="px-1.5 py-0 text-[10px]">silent</Badge>}
                <Badge variant="default" className="px-1.5 py-0 text-[10px]">{job.mode || t('cron.modeDefault')}</Badge>
              </div>

              {/* Info */}
              <div className="space-y-1 text-xs text-ink-soft">
                <div className="flex items-center gap-1.5">
                  <span className="w-12 shrink-0 font-medium text-ink-mute">{t('cron.project')}</span>
                  <span className="truncate">{shownNames(projects)(job.project)}</span>
                </div>
                {job.prompt && (
                  <div className="flex items-start gap-1.5">
                    <span className="w-12 shrink-0 font-medium text-ink-mute">{t('cron.prompt')}</span>
                    <span className="line-clamp-2">{job.prompt}</span>
                  </div>
                )}
                {job.exec && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-12 shrink-0 font-medium text-ink-mute">{t('cron.exec')}</span>
                    <code className="truncate text-[11px]">{job.exec}</code>
                  </div>
                )}
                {job.last_run && (
                  <div className="mt-1 flex items-center gap-1.5 border-t border-hairline pt-1">
                    <span className="w-12 shrink-0 font-medium text-ink-mute">{t('cron.lastRun')}</span>
                    <span>{formatTime(job.last_run)}</span>
                  </div>
                )}
              </div>

              {job.last_error && (
                <p className="text-[11px] text-red-500 mt-2 line-clamp-1">{job.last_error}</p>
              )}

              {/* Action buttons (top right) */}
              <div
                className="absolute right-3 top-3 flex items-center gap-1 rounded-control bg-surface/85 backdrop-blur-sm ring-1 ring-hairline transition-opacity duration-base md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                onClick={e => e.stopPropagation()}
              >
                <button
                  onClick={() => handleTrigger(job)}
                  disabled={triggeringId === job.id}
                  className={cn(
                    'grid h-11 w-11 place-items-center rounded-control transition-colors duration-base md:h-8 md:w-8',
                    'text-accent-text hover:bg-accent-wash disabled:cursor-wait disabled:opacity-50',
                  )}
                  title={t('cron.trigger')}
                >
                  <Play size={14} />
                </button>
                <button
                  onClick={() => handleToggleEnabled(job)}
                  className={cn(
                    'grid h-11 w-11 place-items-center rounded-control transition-colors duration-base md:h-8 md:w-8',
                    job.enabled
                      ? 'text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400'
                      : 'text-ink-mute hover:bg-surface-sunken',
                  )}
                  title={job.enabled ? 'Disable' : 'Enable'}
                >
                  <Power size={14} />
                </button>
                <button
                  onClick={() => handleDelete(job.id)}
                  className="grid h-11 w-11 place-items-center rounded-control text-red-500 transition-colors duration-base hover:bg-red-500/10 md:h-8 md:w-8 dark:text-red-400"
                  title={t('cron.delete')}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit modal */}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={isEdit ? t('cron.editJob') : t('cron.add')}
        className="max-w-xl"
      >
        <div className="space-y-4">
          <Select
            label={t('cron.project')}
            value={form.project}
            onChange={v => setForm({ ...form, project: v })}
            options={projectOptions}
            placeholder={t('cron.selectProject')}
          />

          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-soft">
              {t('cron.schedule')}
            </label>
            <CronPicker value={form.cron_expr} onChange={v => setForm({ ...form, cron_expr: v })} />
          </div>

          <Input
            label={t('cron.description')}
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
            placeholder={t('cron.descPlaceholder')}
          />

          {/* Task type: prompt or exec, mutually exclusive */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-soft">
              {t('cron.taskType')}
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setForm({ ...form, _type: 'prompt' as const })}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-all',
                  form._type === 'prompt'
                    ? 'bg-accent/15 text-accent ring-1 ring-accent/30'
                    : 'bg-surface-sunken text-ink-soft hover:bg-accent-wash hover:text-ink',
                )}
              >
                <MessageSquare size={14} /> {t('cron.prompt')}
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, _type: 'exec' as const })}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-all',
                  form._type === 'exec'
                    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/30'
                    : 'bg-surface-sunken text-ink-soft hover:bg-accent-wash hover:text-ink',
                )}
              >
                <Terminal size={14} /> {t('cron.exec')}
              </button>
            </div>
          </div>

          {form._type === 'prompt' ? (
            <Textarea
              label={t('cron.prompt')}
              value={form.prompt}
              onChange={e => setForm({ ...form, prompt: e.target.value })}
              rows={3}
              placeholder={t('cron.promptPlaceholder')}
            />
          ) : (
            <Input
              label={t('cron.exec')}
              value={form.exec}
              onChange={e => setForm({ ...form, exec: e.target.value })}
              placeholder="npm run report"
            />
          )}

          <Select
            label={t('cron.sessionKey')}
            value={form.session_key}
            onChange={v => setForm({ ...form, session_key: v })}
            options={sessionKeys.map(k => ({ value: k, label: k }))}
            placeholder={t('cron.selectSessionKey')}
          />

          <Select
            label={t('cron.mode')}
            value={form.mode}
            onChange={v => setForm({ ...form, mode: v })}
            options={MODE_OPTIONS.map(m => ({ value: m, label: m }))}
            placeholder={t('cron.modeDefault')}
          />

          <div className="flex items-center gap-6 pt-1">
            <Toggle checked={form.enabled} onChange={v => setForm({ ...form, enabled: v })} label={t('cron.enabled')} />
            <Toggle checked={form.silent} onChange={v => setForm({ ...form, silent: v })} label={t('cron.silent')} />
          </div>

          <div className="flex justify-end gap-2 border-t border-hairline pt-3">
            <Button variant="secondary" onClick={() => setShowForm(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleSave} loading={saving}>
              {isEdit ? t('common.save') : t('cron.add')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
