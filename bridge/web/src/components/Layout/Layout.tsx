import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import Footer from './Footer';
import { cn } from '@/lib/utils';

export default function Layout() {
  const isSetup = useLocation().pathname === '/setup';
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMenuOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mobileMenuOpen]);

  return (
    <div className={cn('relative isolate flex h-screen overflow-hidden bg-canvas text-ink', isSetup && 'setup-layout')}>
      {/* 环境光：全站唯一的循环动效，3000ms 线性级缓动、位移 ≤2%（§9 Framer「环境动效只给背景光斑」）。
          isolate + -z-10 让它只压在画布之上、内容之下；prefers-reduced-motion 时降为一次。 */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] overflow-hidden">
        <span className="absolute -left-24 -top-32 h-80 w-80 rounded-full bg-bokeh/10 blur-3xl animate-[ui-drift_var(--ui-dur-ambient)_ease-in-out_infinite]" />
        <span className="absolute -top-20 right-[6%] h-72 w-72 rounded-full bg-accent/[0.07] blur-3xl animate-[ui-drift_var(--ui-dur-ambient)_ease-in-out_infinite] [animation-delay:-1500ms]" />
      </div>
      {!isSetup && (
        <Sidebar
          mobileOpen={mobileMenuOpen}
          onMobileClose={() => setMobileMenuOpen(false)}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header onMenuClick={() => setMobileMenuOpen(true)} />
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 sm:p-6">
          <div className="flex flex-1 flex-col">
            <Outlet />
          </div>
          <Footer />
        </main>
      </div>
    </div>
  );
}
