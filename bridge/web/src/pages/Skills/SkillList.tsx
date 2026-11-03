import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Sparkles, Star, ExternalLink, FolderOpen, Puzzle, RefreshCw,
} from 'lucide-react';
import { Card, Badge, Button, EmptyState } from '@/components/ui';
import {
  listSkills, fetchSkillPresets,
  type ProjectSkills, type SkillPreset,
} from '@/api/skills';
import { listProjects, shownNames, type ProjectSummary } from '@/api/projects';
import { cn } from '@/lib/utils';

type Tab = 'local' | 'recommended';

export default function SkillList() {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<Tab>('local');
  const [projects, setProjects] = useState<ProjectSkills[]>([]);
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
      const ps = data.projects || [];
      setProjects(ps);
      if (ps.length > 0 && !activeProject) setActiveProject(ps[0].project);
    } catch { /* empty */ }
    setLoading(false);
  }, [activeProject]);

  const loadPresets = useCallback(async () => {
    setPresetsLoading(true);
    try {
      const data = await fetchSkillPresets();
      setPresets(data.skills || []);
    } catch { /* empty */ }
    setPresetsLoading(false);
  }, []);

  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    if (tab === 'recommended' && presets.length === 0) loadPresets();
  }, [tab, presets.length, loadPresets]);

  const current = projects.find(p => p.project === activeProject);
  const lang = i18n.language || 'en';
  // 这一屏的「一个发现」放在标题下：装在几个项目里、一共几个技能，答一眼就知道数量。
  const skillTotal = projects.reduce((n, p) => n + (p.skills?.length || 0), 0);

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
                  ? 'bg-surface text-ink ring-1 ring-hairline'
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
        />
      )}
      {tab === 'recommended' && (
        <RecommendedSkills
          presets={presets}
          loading={presetsLoading}
          onRefresh={loadPresets}
          t={t}
          lang={lang}
        />
      )}
    </div>
  );
}

/* ── Local Skills ── */

function LocalSkills({
  projects, shown, current, activeProject, onSelectProject, loading, t,
}: {
  projects: ProjectSkills[];
  shown: (name: string) => string;
  current?: ProjectSkills;
  activeProject: string;
  onSelectProject: (name: string) => void;
  loading: boolean;
  t: (k: string, opts?: any) => string;
}) {
  if (loading) {
    // 骨架而不是转圈：先摆出侧栏 + 三行卡的位置，数据回来不跳。
    return (
      <div className="flex items-start gap-6" aria-hidden>
        <div className="w-48 shrink-0 space-y-2">
          <div className="h-3 w-16 rounded-control bg-surface-sunken" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-11 rounded-control bg-surface-sunken ring-1 ring-hairline" />
          ))}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-[86px] rounded-card bg-surface-sunken ring-1 ring-hairline" />
          ))}
        </div>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="rounded-card bg-surface p-8 ring-1 ring-hairline">
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
                  ? 'bg-accent-wash text-ink ring-1 ring-accent/25'
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
              <div className="rounded-card bg-surface p-6 ring-1 ring-hairline">
                <EmptyState message={t('skills.emptyProject')} icon={Puzzle} />
              </div>
            ) : (
              <div className="space-y-2">
                {current.skills.map(s => (
                  <Card key={s.name + s.source} className="!py-3">
                    <div className="flex items-start gap-3">
                      {/* 一枚 1px 描边圆托，不是彩色方块：同一栏每个对象都套同一块彩色托，正是被点名的模板痕迹。 */}
                      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface ring-1 ring-hairline">
                        <Puzzle size={13} strokeWidth={1.5} className="text-ink-mute" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-medium text-ink">{s.display_name || s.name}</h3>
                        {s.description && (
                          <p className="mt-0.5 line-clamp-2 text-xs text-ink-soft">{s.description}</p>
                        )}
                        <p className="mt-1 truncate font-mono text-[11px] text-ink-mute">{s.source}</p>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ── Recommended Skills ── */

function RecommendedSkills({
  presets, loading, onRefresh, t, lang,
}: {
  presets: SkillPreset[];
  loading: boolean;
  onRefresh: () => void;
  t: (k: string, opts?: any) => string;
  lang: string;
}) {
  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-[196px] rounded-card bg-surface-sunken ring-1 ring-hairline" />
        ))}
      </div>
    );
  }

  if (presets.length === 0) {
    return (
      <div className="rounded-card bg-surface p-8 ring-1 ring-hairline">
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
        <SkillPresetCard key={s.name} skill={s} t={t} lang={lang} />
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
      <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-500/25 dark:text-emerald-400">
        {t('skills.free')}
      </span>
    );
  }

  if (pricing.type === 'freemium') {
    return (
      <span className="inline-flex items-center rounded-full bg-transparent px-2 py-0.5 text-[11px] font-medium text-ink-soft ring-1 ring-hairline-strong">
        {t('skills.freemium')}
      </span>
    );
  }

  const price = pricing.price ?? 0;
  const currency = pricing.currency || 'USD';
  const symbol = currency === 'CNY' ? '¥' : currency === 'EUR' ? '€' : '$';

  return (
    <span className="inline-flex items-center rounded-full bg-transparent px-2 py-0.5 text-[11px] font-medium tabular-nums text-ink-soft ring-1 ring-hairline-strong">
      {symbol}{price}
    </span>
  );
}

/* ── Skill Card ── */

function SkillPresetCard({
  skill: s, t, lang,
}: {
  skill: SkillPreset;
  t: (k: string) => string;
  lang: string;
}) {
  return (
    <Card className="flex flex-col">
      {/* 精选是一枚行内标记，不是右上角的彩色角标：角标会挡住内容，且白字压在琥珀底上不到 2:1。 */}
      <div className="flex-1 space-y-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium text-ink">{s.display_name || s.name}</h3>
            {s.featured && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-500/25 dark:text-amber-400">
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
        {s.url && (
          <a
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-control px-3 py-1.5 text-xs font-medium text-accent transition-colors duration-base ease-ui-out hover:bg-accent-wash"
          >
            {t('skills.download')} <ExternalLink size={12} />
          </a>
        )}
      </div>
    </Card>
  );
}