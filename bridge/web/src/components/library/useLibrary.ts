import { useCallback, useEffect, useState } from 'react';
import { getLibrary, type Library } from '@/api/library';

/** The merged library for a language, with a reload after each change. */
export function useLibrary(lang: string) {
  const [lib, setLib] = useState<Library | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(() => {
    getLibrary(lang).then((l) => { setLib(l); setError(''); }).catch((e) => setError(e?.message || String(e)));
  }, [lang]);
  useEffect(() => { reload(); }, [reload]);
  return { lib, error, reload };
}
