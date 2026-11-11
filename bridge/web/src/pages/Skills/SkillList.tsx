import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Sparkles, Star, ExternalLink, Download, FolderOpen, Puzzle, RefreshCw, Eye, Pencil, Trash2, Check,
} from 'lucide-react';
import { Card, Badge, Button, EmptyState, Modal, Textarea } from '@/components/ui';
import {
  listSkills, fetchSkillPresets, getManagedSkill, editManagedSkill, deleteManagedSkill,
  setManagedSkillEnabled, approveManagedSkill, installSkillPreset,
  getPendingSkill, editPendingSkill, deletePendingSkill,
  type ProjectSkills, type SkillPreset, type ManagedSkill,
} from '@/api/skills';
import { listProjects, shownNames, type ProjectSummary } from '@/api/projects';
import { cn } from '@/lib/utils';

type Tab = 'local' | 'recommended';

export default function SkillList() {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<Tab>('local');
  const [projects, setProjects] = useState<ProjectSkills[]>([]);
  const [managed, setManaged] = useState<ManagedSkill[]>([]);
  const [pending, setPending] = useState<ManagedSkill[]>([]);
  const [presets, setPresets] = useState<SkillPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [presetsLoading, setPresetsLoading] = useState(false);
  const [activeProject, setActiveProject] = useState('');
  const [summaries, setSummaries] = useState<ProjectSummary[]>([]);
  useEffect(() => {
    listProjects().then((p) => setSummaries(p.projects || [])).catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listSkills();
      const ps = [...(data.projects || [])];
      for (const p of summaries) {
        if (['dsh', 'acp'].includes(p.agent_type) && !ps.some(x => x.project === p.name)) {
          ps.push({ project: p.name, agent_type: p.agent_type, dirs: [], skills: [] });
        }
      }
      setProjects(ps);
      setManaged(data.managed_skills || []);
      setPending(data.pending_skills || []);
      if (ps.length > 0 && !activeProject) setActiveProject(ps[0].project);
    } catch { /* empty */ }
    setLoading(false);
  }, [activeProject, summaries]);

  const loadPresets = useCallback(async () => {
    setPresetsLoading(true);
    try {
      const data = await fetchSkillPresets();
      setPresets(data.skills || []);
    } catch { /* empty */ }
    setPresetsLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (tab === 'recommended' && presets.length === 0) loadPresets();
  }, [tab, presets.length, loadPresets]);

  const current = projects.find(p => p.project === activeProject);
  const lang = i18n.language || 'en';
  // 这一屏的「一个发现」放在标题下：装在几个项目里、一共几个技能，答一眼就知道数量。
  const skillTotal = projects.reduce((n, p) => n + (p.skills?.length || 0), 0);
  const install = async (name: string) => {
    if (!activeProject) return;
    try { await installSkillPreset(name, activeProject); await refresh(); }
    catch (e) { window.alert(String(e)); }
  };

  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-ink">{t('skills.title')}</h1>
        <p className="mt-1 text-sm text-ink-soft">{t('skills.subtitle')}</p>
        {tab === 'local' && projects.length > 0 && (
          <p className="mt-2 text-xs text-ink-mute tabular-nums">
            {projects.length} 个项目 · {skillTotal} 个技能
          </p>
        )}
      </div>

      {/* 分段控件用明度台阶表示选中，不用阴影：阴影房规只留给真正浮起来的浮层。 */}
      <div className="flex items-center justify-between gap-3">
        <div role="tablist" aria-label={t('skills.title')} className="flex w-fit gap-1 rounded-card bg-surface-sunken p-1">
          {(['local', 'recommended'] as const).map(key => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                'rounded-control px-4 py-1.5 text-sm font-medium transition-colors duration-base ease-ui-out',
                tab === key
                  ? 'bg-surface text-ink border border-hairline'
                  : 'text-ink-soft hover:text-ink',
              )}
            >
              {t(`skills.tab.${key}`)}
            </button>
          ))}
        </div>
        {tab === 'recommended' && (
          <Button variant="ghost" size="sm" onClick={loadPresets}>
            <RefreshCw size={14} className="mr-1.5" />
            {t('common.refresh')}
          </Button>
        )}
      </div>

      {tab === 'local' && (
        <LocalSkills
          projects={projects}
          shown={shownNames(summaries)}
          current={current}
          activeProject={activeProject}
          onSelectProject={setActiveProject}
          loading={loading}
          t={t}
          managed={managed}
          pending={pending.filter(s => s.owner === activeProject)}
          refresh={refresh}
        />
      )}
      {tab === 'recommended' && (
        <RecommendedSkills
          presets={presets}
          loading={presetsLoading}
          onRefresh={loadPresets}
          t={t}
          lang={lang}
          activeProject={activeProject}
          onInstall={install}
          installed={new Set(managed.map(s => s.name))}
        />
      )}
    </div>
  );
}

/* ── Local Skills ── */

function LocalSkills({
  projects, shown, current, activeProject, onSelectProject, loading, t, managed, pending, refresh,
}: {
  projects: ProjectSkills[];
  shown: (name: string) => string;
  current?: ProjectSkills;
  activeProject: string;
  onSelectProject: (name: string) => void;
  loading: boolean;
  t: (k: string, opts?: any) => string;
  managed: ManagedSkill[];
  pending: ManagedSkill[];
  refresh: () => void;
}) {
  if (loading) {
    // 骨架而不是转圈：先摆出侧栏 + 三行卡的位置，数据回来不跳。
    return (
      <div className="flex items-start gap-6" aria-hidden>
        <div className="w-48 shrink-0 space-y-2">
          <div className="h-3 w-16 rounded-control bg-surface-sunken" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-11 rounded-control bg-surface-sunken border border-hairline" />
          ))}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-[86px] rounded-card bg-surface-sunken border border-hairline" />
          ))}
        </div>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="rounded-card bg-surface p-8 border border-hairline">
        <EmptyState message={t('skills.noSkills')} hint={t('skills.noSkillsHint')} icon={Puzzle} />
      </div>
    );
  }

  return (
    <div className="flex items-start gap-6">
      <div className="w-48 shrink-0 sticky top-4 max-h-[calc(100vh-8rem)] overflow-y-auto">
        <p className="mb-2 px-2 text-xs font-medium text-ink-mute">{t('skills.projects')}</p>
        <div className="space-y-0.5">
          {projects.map(p => (
            <button
              key={p.project}
              onClick={() => onSelectProject(p.project)}
              aria-current={activeProject === p.project || undefined}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-control px-3 py-2 text-left text-sm',
                'transition-colors duration-base ease-ui-out',
                activeProject === p.project
                  ? 'bg-accent-wash text-ink border border-accent/25'
                  : 'text-ink-soft hover:bg-surface-sunken hover:text-ink',
              )}
            >
              <FolderOpen size={15} className={cn('shrink-0', activeProject === p.project ? 'text-accent' : 'text-ink-mute')} />
              <div className="min-w-0 flex-1">
                <div className="truncate">{shown(p.project)}</div>
                <div className="truncate text-[11px] text-ink-mute">{p.agent_type}</div>
              </div>
              <Badge variant="outline" className="shrink-0 text-[10px] tabular-nums">{p.skills?.length || 0}</Badge>
            </button>
          ))}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        {current && (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-medium text-ink">{shown(current.project)}</h2>
              <Badge variant="default">{current.agent_type}</Badge>
              <span className="text-xs text-ink-mute tabular-nums">
                {t('skills.skillCount', { count: current.skills?.length || 0 })}
              </span>
            </div>

            {current.dirs && current.dirs.length > 0 && (
              <div className="mb-4 rounded-card border border-hairline bg-surface-sunken px-3 py-2">
                <p className="mb-1 text-[11px] font-medium text-ink-mute">{t('skills.scanDirs')}</p>
                {current.dirs.map(d => (
                  // 绝对路径是标识符，mono 是它的正确排法（房规：正文不用等宽字体）
                  <p key={d} className="truncate font-mono text-[11px] text-ink-soft">{d}</p>
                ))}
              </div>
            )}

            {(!current.skills || current.skills.length === 0) ? (
              <p className="mb-2 text-sm text-ink-mute">{t('skills.emptyProject')}</p>
            ) : (
              <div className="space-y-2">
                {current.skills.map(s => (
                  <Card key={s.name + s.source} className="!py-3">
                    <div className="flex items-start gap-3">
                      {/* 每行都套同一枚托（不管描边还是填色）仍是模板习惯；只留一枚裸图标 */}
                      <Puzzle size={14} strokeWidth={1.5} className="mt-1 shrink-0 text-ink-mute" />
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-medium text-ink">{s.display_name || s.name}</h3>
                        {s.description && (
                          <p className="mt-0.5 line-clamp-2 text-[13px] text-ink-soft">{s.description}</p>
                        )}
                        <p className="mt-1 truncate font-mono text-xs text-ink-mute">{s.source}</p>
                        {s.global && <Badge variant="outline">{t('skills.global', '全局，所有角色可见')}</Badge>}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
            {managed.length > 0 && (
              <section className="mt-6 space-y-2" aria-label={t('skills.managed', '托管技能')}>
                <h3 className="text-sm font-semibold text-ink">{t('skills.managed', '托管技能')}</h3>
                {managed.map(skill => <ManagedSkillCard key={skill.name} skill={skill} project={activeProject} refresh={refresh} t={t} />)}
              </section>
            )}
            {pending.some(skill => skill.owner === activeProject) && (
              <section className="mt-6 space-y-2" aria-label={t('skills.pending', '待确认')}>
                <h3 className="text-sm font-semibold text-ink">{t('skills.pending', '待确认')}</h3>
                {pending.filter(skill => skill.owner === activeProject).map(skill => (
                  <ManagedSkillCard key={`${skill.owner}/${skill.name}`} skill={skill} project={skill.owner!} pending refresh={refresh} t={t} />
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ManagedSkillCard({ skill, project, pending = false, refresh, t }: {
  skill: ManagedSkill; project: string; pending?: boolean; refresh: () => void; t: (k: string, fallback?: string) => string;
}) {
  const [body, setBody] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const useCount = skill.uses?.[project];
  const loadBody = async () => {
    const data = pending ? await getPendingSkill(skill.name, project) : await getManagedSkill(skill.name);
    setBody(data.body || '');
    setEditing(false);
    setOpen(true);
  };
  const save = async () => {
    setBusy(true);
    try {
      if (pending) await editPendingSkill(skill.name, project, body);
      else await editManagedSkill(skill.name, body);
      setOpen(false); refresh();
    }
    catch (e) { window.alert(String(e)); }
    setBusy(false);
  };
  return (
    <Card className="!py-3">
      <div className="flex flex-wrap items-start gap-3">
        <Puzzle size={15} className="mt-1 shrink-0 text-ink-mute" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><h4 className="text-sm font-medium">{skill.name}</h4>{pending ? <Badge variant="warning">{t('skills.awaiting', '待确认')}</Badge> : skill.learned && <Badge variant="success">{t('skills.learned', '自己学会的')}</Badge>}</div>
          {skill.description && <p className="mt-1 text-[13px] text-ink-soft">{skill.description}</p>}
          {!pending && <p className="mt-1 text-xs text-ink-mute">{t('skills.uses', '使用次数')}: {useCount == null ? t('skills.unknown', '无法统计') : useCount}</p>}
        </div>
        {pending ? <Button size="sm" disabled={busy} onClick={async () => {
          setBusy(true);
          try { await approveManagedSkill(skill.name, project); refresh(); }
          catch (e) { window.alert(String(e)); }
          finally { setBusy(false); }
        }}><Check size={14} />{t('skills.approve', '确认生效')}</Button> :
          <label className="inline-flex items-center gap-2 text-xs text-ink-soft"><input type="checkbox" checked={skill.enabled?.[project] === true} onChange={async e => { setBusy(true); try { await setManagedSkillEnabled(skill.name, project, e.target.checked); refresh(); } catch (e) { window.alert(String(e)); } finally { setBusy(false); } }} disabled={busy} />{t('skills.enabled', '启用')}</label>}
        <Button size="sm" className="!p-2" variant="ghost" title={t('skills.view', '查看正文')} aria-label={t('skills.view', '查看正文')} onClick={loadBody}><Eye size={15} /></Button>
        <Button size="sm" className="!p-2" variant="ghost" title={t('skills.edit', '编辑')} aria-label={t('skills.edit', '编辑')} onClick={async () => { await loadBody(); setEditing(true); }}><Pencil size={15} /></Button>
        <Button size="sm" className="!p-2" variant="ghost" title={t('skills.delete', '删除')} aria-label={t('skills.delete', '删除')} onClick={async () => { if (window.confirm(t('skills.deleteConfirm', `删除 ${skill.name}？`))) {
          try {
            if (pending) await deletePendingSkill(skill.name, project);
            else await deleteManagedSkill(skill.name);
            refresh();
          } catch (e) { window.alert(String(e)); }
        } }}><Trash2 size={15} /></Button>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? t('skills.edit', '编辑技能') : skill.name} className="max-w-3xl">
        {editing ? <Textarea aria-label={t('skills.body', '正文')} rows={22} value={body} onChange={e => setBody(e.target.value)} /> : <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap text-sm text-ink-soft">{body}</pre>}
        <div className="mt-4 flex justify-end gap-2">
          {editing && <Button variant="secondary" onClick={() => setEditing(false)}>{t('common.cancel', '取消')}</Button>}
          {editing && <Button onClick={save} disabled={busy}>{t('common.save', '保存')}</Button>}
        </div>
      </Modal>
    </Card>
  );
}

/* ── Recommended Skills ── */

function RecommendedSkills({
  presets, loading, onRefresh, t, lang, activeProject, onInstall, installed,
}: {
  presets: SkillPreset[];
  loading: boolean;
  onRefresh: () => void;
  t: (k: string, opts?: any) => string;
  lang: string;
  activeProject: string;
  onInstall: (name: string) => void;
  installed: Set<string>;
}) {
  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-[196px] rounded-card bg-surface-sunken border border-hairline" />
        ))}
      </div>
    );
  }

  if (presets.length === 0) {
    return (
      <div className="rounded-card bg-surface p-8 border border-hairline">
        <EmptyState message={t('skills.noPresets')} hint={t('skills.noPresetsHint')} icon={Sparkles} />
        <div className="mt-2 flex justify-center">
          <Button variant="ghost" size="sm" onClick={onRefresh}>
            <RefreshCw size={14} className="mr-1.5" />
            {t('common.refresh')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {presets.map(s => (
        <SkillPresetCard key={s.name} skill={s} t={t} lang={lang} activeProject={activeProject} onInstall={onInstall} installed={installed.has(s.name)} />
      ))}
    </div>
  );
}

/* ── Pricing Badge ── */

/** 价格是数据，不是警报：只有免费（能直接装）用语义绿，其余走 ink 灰阶；
 *  一屏里不再同时出现绿/蓝/琥珀三个色家族。 */
function PricingBadge({ pricing, t }: { pricing: SkillPreset['pricing']; t: (k: string) => string }) {
  if (!pricing) return null;

  if (pricing.type === 'free') {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 border border-emerald-500/25 dark:text-emerald-400">
        {t('skills.free')}
      </span>
    );
  }

  if (pricing.type === 'freemium') {
    return (
      <span className="inline-flex items-center rounded-full bg-transparent px-2 py-0.5 text-[11px] font-medium text-ink-soft border border-hairline-strong">
        {t('skills.freemium')}
      </span>
    );
  }

  const price = pricing.price ?? 0;
  const currency = pricing.currency || 'USD';
  const symbol = currency === 'CNY' ? '¥' : currency === 'EUR' ? '€' : '$';

  return (
    <span className="inline-flex items-center rounded-full bg-transparent px-2 py-0.5 text-[11px] font-medium tabular-nums text-ink-soft border border-hairline-strong">
      {symbol}{price}
    </span>
  );
}

/* ── Skill Card ── */

function SkillPresetCard({
  skill: s, t, lang, activeProject, onInstall, installed,
}: {
  skill: SkillPreset;
  t: (k: string, opts?: any) => string;
  lang: string;
  activeProject: string;
  onInstall: (name: string) => void;
  installed: boolean;
}) {
  return (
    <Card className="flex flex-col">
      {/* 精选是一枚行内标记，不是右上角的彩色角标：角标会挡住内容，且白字压在琥珀底上不到 2:1。 */}
      <div className="flex-1 space-y-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium text-ink">{s.display_name || s.name}</h3>
            {s.featured && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 border border-amber-500/25 dark:text-amber-400">
                <Star size={10} strokeWidth={2} />
                {t('skills.featured')}
              </span>
            )}
            {s.version && <Badge variant="outline" className="text-[10px]">{s.version}</Badge>}
            <PricingBadge pricing={s.pricing} t={t} />
          </div>
          {(s.description || s.description_zh) && (
            <p className="mt-1.5 line-clamp-2 text-sm text-ink-soft">
              {lang.startsWith('zh') && s.description_zh ? s.description_zh : s.description}
            </p>
          )}
        </div>

        {s.tags && s.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {s.tags.map(tag => (
              <Badge key={tag} variant="default" className="text-[11px]">{tag}</Badge>
            ))}
          </div>
        )}
      </div>

      {/* Footer: source + author left, download right */}
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-hairline pt-3">
        <div className="flex min-w-0 items-center gap-3 text-[11px] text-ink-mute">
          {s.source && (
            <span className="inline-flex shrink-0 items-center gap-1">
              {t('skills.source')}:
              {s.source.url ? (
                <a href={s.source.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                  {s.source.name || s.source.provider}
                </a>
              ) : (
                <span>{s.source.name || s.source.provider}</span>
              )}
            </span>
          )}
          {s.author && <span className="truncate">{t('skills.author')}: {s.author}</span>}
        </div>
        <Button size="sm" disabled={!s.install_url || !activeProject || installed} title={!s.install_url ? t('skills.installUnavailable', { defaultValue: '没有可用的安装来源' }) : undefined} onClick={() => onInstall(s.name)}>
          {installed ? t('skills.installed', { defaultValue: '已安装' }) : t('skills.install', { defaultValue: '安装到托管库' })} {!installed && <Download size={12} />}
        </Button>
      </div>
    </Card>
  );
}
