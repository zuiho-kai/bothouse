import { Outlet, useLocation } from 'react-router-dom';
import Header from './Header';
import Footer from './Footer';
import MobileNav from './MobileNav';
import { cn } from '@/lib/utils';

// #579 v2 shell: one top bar (tabs + all-features launcher) over a single content column; phones
// get a bottom tab bar instead. No sidebar, so the panel framed in DSH sits next to DSH's own
// sidebar without a second one.
export default function Layout() {
  const isSetup = useLocation().pathname === '/setup';

  return (
    <div className={cn('ui-safe-x relative flex h-screen flex-col overflow-hidden bg-canvas text-ink', isSetup && 'setup-layout')}>
      <Header />
      <main className="ui-safe-main flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 pt-5 sm:px-6 md:px-8 md:pt-8">
        <div className="mx-auto flex w-full max-w-[1240px] flex-1 flex-col">
          <Outlet />
        </div>
        <Footer />
      </main>
      {!isSetup && <MobileNav />}
    </div>
  );
}
