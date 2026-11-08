import { Routes, Route, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { sameSitePath } from '@/lib/nextPath';
import { useAuthStore } from '@/store/auth';
import Layout from '@/components/Layout/Layout';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import Usage from '@/pages/Usage';
import ProjectList from '@/pages/Projects/ProjectList';
import ProjectDetail from '@/pages/Projects/ProjectDetail';
import SessionList from '@/pages/Sessions/SessionList';
import SessionChat from '@/pages/Sessions/SessionChat';
import ChatList from '@/pages/Chat/ChatList';
import ChatView from '@/pages/Chat/ChatView';
import CronList from '@/pages/Cron/CronList';
import SystemConfig from '@/pages/System/Config';
import LibraryPage from './pages/Library/LibraryPage';
import ProviderList from '@/pages/Providers/ProviderList';
import SkillList from '@/pages/Skills/SkillList';
import SetupWizard from '@/pages/Setup/SetupWizard';
import RoleList from '@/pages/Roles/RoleList';
import DeviceList from '@/pages/Devices/DeviceList';
import AppList from '@/pages/Apps/AppList';
import BridgeAdapters from '@/pages/Bridge/BridgeAdapters';
import WikiGalaxyPage from '@/pages/Wiki/WikiGalaxyPage';
import PluginList from '@/pages/Plugins/PluginList';
import PetPage from '@/pages/Pet/PetPage';
import NotFound from '@/pages/NotFound';
import ImageGenPage from '@/pages/ImageGen/ImageGenPage';
import GateSettingsPage from '@/pages/Gate/GateSettings';
import ForumPage from '@/pages/Forum/ForumPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const location = useLocation();
  // Carry the query along: the bridge prints links like /?token=…&next=… and the old redirect
  // dropped everything after the path, so the token never reached the login form.
  let search = location.search;
  // A deep link without `next` (typed URL, bookmark) would otherwise land on `/` after login.
  // The path travels as `next`; an explicit `next` in the URL still wins, and AfterLogin keeps
  // refusing off-site targets, so this does not open a redirect hole.
  if (!(new URLSearchParams(search)).has('next') && location.pathname !== '/') {
    const params = new URLSearchParams(search);
    params.set('next', location.pathname + location.search);
    search = `?${params.toString()}`;
  }
  if (!isAuthenticated) return <Navigate to={{ pathname: '/login', search }} replace />;
  return <>{children}</>;
}

// The sidebar's "add platform" and "add role" both open /setup with different queries: a fresh
// wizard for each, not the step the other one was on.
function SetupRoute() {
  const [params] = useSearchParams();
  return <SetupWizard key={params.toString()} />;
}

// After logging in from a link like /login?token=…&next=/setup, go to `next` (same-site paths only).
function AfterLogin() {
  const [params] = useSearchParams();
  return <Navigate to={sameSitePath(params.get('next'))} replace />;
}

export default function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <AfterLogin /> : <Login />} />
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="usage" element={<Usage />} />
        <Route path="setup" element={<SetupRoute />} />
        <Route path="roles" element={<RoleList />} />
        <Route path="devices" element={<DeviceList />} />
        <Route path="wiki-galaxy" element={<WikiGalaxyPage />} />
        <Route path="apps" element={<AppList />} />
        {/* 闸门设置 (#217): 装好以后改谁在什么时候接话，不用重装 */}
        <Route path="gate" element={<GateSettingsPage />} />
        <Route path="forum" element={<ForumPage />} />
        <Route path="plugins" element={<PluginList />} />
        <Route path="plugins/pet" element={<PetPage />} />
        <Route path="pet" element={<PetPage />} />
        <Route path="projects" element={<ProjectList />} />
        <Route path="projects/:name" element={<ProjectDetail />} />
        <Route path="sessions" element={<SessionList />} />
        <Route path="sessions/:project/:id" element={<SessionChat />} />
        <Route path="providers" element={<ProviderList />} />
        <Route path="bridge" element={<BridgeAdapters />} />
        <Route path="skills" element={<SkillList />} />
        <Route path="chat" element={<ChatList />} />
        <Route path="chat/:name" element={<ChatView />} />
        <Route path="cron" element={<CronList />} />
        <Route path="library" element={<LibraryPage />} />
        <Route path="image-gen" element={<ImageGenPage />} />
        <Route path="system" element={<SystemConfig />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
