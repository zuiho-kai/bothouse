import { useEffect, useState } from 'react';
import { getSessionModel } from '@/api/sessions';

export function useSessionModel(project: string | undefined, sessionKey: string, sessionId = ''): string {
  const [selection, setSelection] = useState<{ project: string; sessionKey: string; sessionId: string; model: string }>();

  useEffect(() => {
    if (!project || !sessionKey) return;
    const selectedProject = project;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function refresh() {
      const result = await getSessionModel(selectedProject, sessionKey, sessionId).catch(() => null);
      if (cancelled) return;
      if (result) setSelection({ project: selectedProject, sessionKey, sessionId, ...result });
      timer = setTimeout(refresh, 5000);
    }

    void refresh();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [project, sessionKey, sessionId]);

  return selection && selection.project === project && selection.sessionKey === sessionKey && selection.sessionId === sessionId
    ? selection.model : '';
}
