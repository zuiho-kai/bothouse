import { useEffect, useState } from 'react';
import { getStatus } from '@/api/status';
import { cn } from '@/lib/utils';

const link = cn(
  'rounded transition-colors duration-base ease-ui-out hover:text-accent-text',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-text focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
);

export default function Footer() {
  const [version, setVersion] = useState('');

  useEffect(() => {
    getStatus().then(s => setVersion(s.version || '')).catch(() => {});
  }, []);

  const year = new Date().getFullYear();

  return (
    <footer className="mt-4 shrink-0 select-none pb-1 pt-3 text-center text-xs text-ink-mute">
      <span>© {year} bothouse</span>
      {version && <span className="mx-1.5 opacity-60">·</span>}
      {version && <span className="tabular-nums">{version.startsWith('v') ? version : `v${version}`}</span>}
      <span className="mx-1.5 opacity-60">·</span>
      <a
        href="https://github.com/zuiho-kai/bothouse"
        target="_blank"
        rel="noopener noreferrer"
        className={link}
      >
        GitHub
      </a>
      <span className="mx-1.5 opacity-60">·</span>
      {/* 项目署名 */}
      <a
        href="https://github.com/zuiho-kai/bothouse"
        target="_blank"
        rel="noopener noreferrer"
        className={link}
      >
        Built on bothouse
      </a>
    </footer>
  );
}
