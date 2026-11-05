import { useEffect, useRef } from 'react';

/** Refresh mounted, visible pages on the shared command, return to the page and periodically. */
export function usePageRefresh(refresh: () => void) {
  const current = useRef(refresh);
  current.current = refresh;
  useEffect(() => {
    const run = () => current.current();
    const visible = () => { if (document.visibilityState === 'visible') run(); };
    run();
    window.addEventListener('cc:refresh', run);
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    const timer = window.setInterval(visible, 30000);
    return () => {
      window.removeEventListener('cc:refresh', run);
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
      window.clearInterval(timer);
    };
  }, []);
}
