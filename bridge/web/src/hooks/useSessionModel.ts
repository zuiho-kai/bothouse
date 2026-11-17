import { useEffect, useState } from 'react';
import { getSessionModel } from '@/api/sessions';

export function useSessionModel(project: string | undefined, sessionKey: string): string {
  const [selection, setSelection] = useState<{ project: string; sessionKey: string; model: string }>();

  useEffect(() => {
    if (!project || !sessionKey) return;
    const selectedProject = project;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function refresh() {
      const result = await getSessionModel(selectedProject, sessionKey).catch(() => null);
      if (cancelled) return;
      if (result) setSelection({ project: selectedProject, sessionKey, model: result.model });
      timer = setTimeout(refresh, 5000);
    }

    void refresh();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [project, sessionKey]);

  return selection && selection.project === project && selection.sessionKey === sessionKey ? selection.model : '';
}
