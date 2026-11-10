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
    <div className={cn('ui-safe-x relative flex h-screen overflow-hidden bg-canvas text-ink', isSetup && 'setup-layout')}>
      {/* 画布是平的：应用界面不做背景装饰动效（房规：动效只作反馈，饰光与色球是模板味）。 */}
      {!isSetup && (
        <Sidebar
          mobileOpen={mobileMenuOpen}
          onMobileClose={() => setMobileMenuOpen(false)}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header onMenuClick={() => setMobileMenuOpen(true)} />
        <main className="ui-safe-main flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 pt-5 sm:px-8 sm:pt-8">
          {/* 内容限宽 1280 居中：宽屏上表格和卡片不被拉成细长条（与 DSH 主区同一阅读宽度） */}
          <div className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col">
            <Outlet />
          </div>
          <Footer />
        </main>
      </div>
    </div>
  );
}
