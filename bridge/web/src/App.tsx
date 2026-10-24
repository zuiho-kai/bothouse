import { Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import Layout from '@/components/Layout/Layout';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import Usage from '@/pages/Usage';
import ProjectList from '@/pages/Projects/ProjectList';
import ProjectDetail from '@/pages/Projects/ProjectDetail';
import ChatList from '@/pages/Chat/ChatList';
import ChatView from '@/pages/Chat/ChatView';
import CronList from '@/pages/Cron/CronList';
import SystemConfig from '@/pages/System/Config';
import LibraryPage from './pages/Library/LibraryPage';
import ProviderList from '@/pages/Providers/ProviderList';
import SkillList from '@/pages/Skills/SkillList';
import SetupWizard from '@/pages/Setup/SetupWizard';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// After logging in from a link like /login?token=…&next=/setup, go to `next` (same-site paths only).
function AfterLogin() {
  const [params] = useSearchParams();
  const next = params.get('next');
  return <Navigate to={next && next.startsWith('/') && !next.startsWith('//') ? next : '/'} replace />;
}

export default function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <AfterLogin /> : <Login />} />
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="usage" element={<Usage />} />
        <Route path="setup" element={<SetupWizard />} />
        <Route path="projects" element={<ProjectList />} />
        <Route path="projects/:name" element={<ProjectDetail />} />
        <Route path="providers" element={<ProviderList />} />
        <Route path="skills" element={<SkillList />} />
        <Route path="chat" element={<ChatList />} />
        <Route path="chat/:name" element={<ChatView />} />
        <Route path="cron" element={<CronList />} />
        <Route path="library" element={<LibraryPage />} />
        <Route path="system" element={<SystemConfig />} />
      </Route>
    </Routes>
  );
}
