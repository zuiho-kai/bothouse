import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Info, RotateCw, Smartphone } from 'lucide-react';
import { Badge, Button, LoadingState, PageHeader } from '@/components/ui';
import { listModules, type PlatformModule } from '@/api/modules';
import { listProjects, shownNames, type ProjectSummary } from '@/api/projects';
import { appTexts } from './texts';

/**
 * 接入应用 (#150): one page for the outside apps (QQ / Discord / 飞书) and DSH itself.
 *
 * The rows are read-only. Adding a platform (and adding one more role on a platform already in
 * use) is the setup wizard's add mode, which appends without touching existing roles. Turning a
 * disabled module back on is `bothouse module add <platform>` with no flags (#812), so that row
 * shows the command instead of a button this page cannot honestly perform.
 */
export default function AppList() {
  const { i18n } = useTranslation();
  const T = appTexts(i18n.language || 'en');
  const [modules, setModules] = useState<PlatformModule[]>([]);
  const [configured, setConfigured] = useState(0);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [mods, p] = await Promise.all([listModules(), listProjects().catch(() => null)]);
      setModules(mods.modules || []);
      setConfigured(mods.configured || 0);
      if (p) setProjects(p.projects || []);
      setError('');
    } catch (e: any) {
      setError(e?.message || '');
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

  // Roles are shown by the name their owner gave them (team_name), like every other page.
  const showName = shownNames(projects);

  const stateBadge = (m: PlatformModule) => {
    if (m.state === 'enabled') return <Badge variant="success">{T.stateEnabled}</Badge>;
    if (m.state === 'disabled') return <Badge variant="warning">{T.stateDisabled}</Badge>;
    return <Badge variant="outline">{T.stateMissing}</Badge>;
  };

  const hint = (name: PlatformModule['name']) =>
    name === 'qq' ? T.qqHint : name === 'dsh' ? T.dshHint : T.otherHint;

  return (
    <div className="space-y-5 animate-fade-in" data-testid="apps-page">
      <PageHeader
        icon={Smartphone}
        title={T.title}
        description={T.subtitle}
        actions={
          <>
            {configured > 0 && <Badge variant="outline">{T.configuredCount(configured)}</Badge>}
            <Button variant="secondary" size="sm" onClick={fetchData} disabled={loading}>
              <RotateCw size={14} className={loading ? 'animate-spin' : ''} />
              {T.refresh}
            </Button>
          </>
        }
      />

      {error && (
        <div className="rounded-card bg-surface p-4 text-sm text-ink-soft ring-1 ring-hairline">
          <p className="font-medium text-ink">{T.loadFailed}</p>
          <p className="mt-1 break-words text-xs text-ink-mute">{error}</p>
        </div>
      )}

      {loading && modules.length === 0 ? (
        <LoadingState label={T.loading} />
      ) : modules.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {modules.map((m) => {
            const used = [...(m.enabled || []), ...(m.disabled || [])];
            return (
              <article
                key={m.name}
                data-testid={`app-${m.name}`}
                data-state={m.state}
                className="rounded-card bg-surface p-5 ring-1 ring-hairline transition-[box-shadow,background-color] duration-state ease-ui-standard hover:ring-hairline-strong"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-card bg-surface-sunken ring-1 ring-hairline">
                      <Smartphone size={18} strokeWidth={1.5} className="text-ink-soft" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium text-ink">{m.label}</span>
                        {stateBadge(m)}
                      </div>
                      {/* DSH has no roles of its own: its state is the plugin, not a project section. */}
                      <p className="mt-1 text-xs text-ink-mute">
                        {m.name === 'dsh'
                          ? T.dshOwner
                          : used.length > 0 ? `${T.usedBy} ${used.map(showName).join(' · ')}` : T.noProjects}
                      </p>
                    </div>
                  </div>
                  {m.state === 'disabled' ? null : (
                    <Link
                      to={m.add_path}
                      data-testid={`app-${m.name}-add`}
                      className={m.state === 'not_configured'
                        ? 'shrink-0 rounded-control bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors duration-base hover:bg-accent-dim dark:text-black yellow:text-gray-900'
                        : 'shrink-0 rounded-control bg-surface-sunken px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors duration-base hover:bg-accent-wash hover:text-ink'}
                    >
                      {m.state === 'not_configured' ? T.add : m.name === 'dsh' ? T.dshConfigure : T.addAnother}
                    </Link>
                  )}
                </div>
                <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-ink-soft">
                  <Info size={14} strokeWidth={1.6} className="mt-0.5 shrink-0 text-ink-mute" />
                  {hint(m.name)}
                </p>
                {/* A disabled module keeps its credentials; turning it back on is one command, and
                    this page does not pretend to run it. */}
                {m.state === 'disabled' && (
                  <p className="mt-2 text-xs text-ink-mute">
                    {T.resumeWith} <code className="rounded bg-surface-sunken px-1.5 py-0.5 text-[11px] text-ink-soft">bothouse module add {m.name}</code>
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
