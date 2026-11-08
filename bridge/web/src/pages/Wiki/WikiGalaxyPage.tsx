import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Sparkles, RotateCw, ExternalLink, ArrowLeft } from 'lucide-react';
import { Button, PageHeader } from '@/components/ui';
import { api } from '@/api/client';
import { collabPageUrl } from '@/lib/collabPages';
import { goToDsh } from '@/lib/openDsh';
import { DSHNotice } from '@/components/DSHNotice';

/**
 * Wiki 星河 as a bothouse sub-page (#145).
 *
 * The galaxy itself is the collab host's own page at `/collab/wiki-galaxy` (dsh/collab/
 * wiki-galaxy.mjs): one read-only fetch, no state, no write path. Re-implementing the canvas
 * here would fork the graph layout and the wiki scan, so this page frames the existing page
 * instead — same origin, same sign-in, no token reaches the frame.
 */
export default function WikiGalaxyPage() {
  const { t } = useTranslation();
  const src = collabPageUrl('wiki-galaxy', undefined, api.getToken());
  // Reload means "ask the framed page again", not "re-mount the panel": a changing key
  // re-creates the frame, which refetches the graph.
  const [reload, setReload] = useState(0);
  const embedded = window.self !== window.top;
  const [availability, setAvailability] = useState<'checking' | 'running' | 'stopped' | 'error'>('checking');
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (!embedded) return;
    const controller = new AbortController();
    // Check the actual collab page, not the management server's DSH process state:
    // an embedded panel can be served by a different, healthy DSH host.
    // GET is intentional: the collab galaxy route does not handle HEAD.
    void fetch(src, { signal: controller.signal, cache: 'no-store' }).then((response) => {
      if (!controller.signal.aborted) {
        // 来源：HTTP 503 is the proxy's explicit DSH-not-running response.
        setAvailability(response.ok ? 'running' : response.status === 503 ? 'stopped' : 'error');
      }
    }).catch(() => {
      if (!controller.signal.aborted) setAvailability('error');
    });
    return () => controller.abort();
  }, [embedded, src, reload]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="wiki-galaxy-page">
      <Link
        to="/"
        className="inline-flex w-fit items-center gap-1.5 rounded-control px-2.5 py-1.5 text-sm text-ink-soft transition-colors duration-base hover:bg-surface-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-text"
      >
        <ArrowLeft size={14} />
        {t('nav.dashboard')}
      </Link>
      <PageHeader
        icon={Sparkles}
        title={t('wikiGalaxy.title', 'Wiki 星河')}
        description={t('wikiGalaxy.subtitle', '把 wiki 画成星系：每页一颗星，点星看内容。只读，不改任何文件。')}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => { setAvailability('checking'); setReload((n) => n + 1); }}>
              <RotateCw size={14} />
              {t('common.refresh', '刷新')}
            </Button>
            <a
              className="inline-flex items-center gap-1.5 rounded-control px-2.5 py-1.5 text-sm text-ink-soft transition-colors duration-base hover:bg-surface-sunken hover:text-ink"
              href={src}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={14} />
              {t('wikiGalaxy.open', '单独打开')}
            </a>
          </>
        }
      />
      <div className="min-h-[70vh] flex-1 overflow-hidden rounded-card border border-hairline bg-surface">
        {embedded && availability !== 'running' ? (
          <div className="flex flex-col items-start gap-3 p-4">
            {availability === 'checking' ? <p role="status">{t('common.loading')}</p> : (
              <>
                <DSHNotice status={availability} />
                <Button variant="secondary" disabled={opening} onClick={() => {
                  setOpening(true);
                  void goToDsh(src).finally(() => setOpening(false));
                }}>{t('dshManage.openDsh')}</Button>
              </>
            )}
          </div>
        ) : <iframe
          key={reload}
          className="h-full min-h-[70vh] w-full border-0"
          src={src}
          title={t('wikiGalaxy.title', 'Wiki 星河')}
          loading="lazy"
          referrerPolicy="no-referrer"
          data-testid="wiki-galaxy-frame"
        />}
      </div>
    </div>
  );
}
