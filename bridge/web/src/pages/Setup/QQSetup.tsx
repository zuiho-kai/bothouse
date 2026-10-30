import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Card, Input } from '@/components/ui';
import type { LocalCLI } from '@/api/wizard';
import { restartSystem } from '@/api/status';
import PlatformManualForm from '@/pages/Projects/PlatformManualForm';

export default function QQSetup({ clis, projects, onBack }: {
  clis: LocalCLI[] | null; projects: string[]; onBack: () => void;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = useState('qq');
  const [project, setProject] = useState('');
  const [agent, setAgent] = useState('');
  const [workDir, setWorkDir] = useState('');
  const [saved, setSaved] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [restartRequested, setRestartRequested] = useState(false);
  const [error, setError] = useState('');
  const available = (clis || []).filter(c => c.supported);
  const selectedAgent = agent || available.find(c => c.login === 'logged_in')?.agent_type || available[0]?.agent_type || '';
  const name = project.trim();
  const validName = /^[a-zA-Z0-9_-]+$/.test(name) && !projects.includes(name);

  return <Card className="max-w-2xl mx-auto space-y-4">
    <h2 className="text-lg font-semibold">{t('qq.setupTitle')}</h2>
    {saved ? <>
      <p role="status">{t(restartRequested ? 'qq.restartRequested' : 'qq.savedRestart')}</p>
      {error && <p role="alert" className="text-red-500">{error}</p>}
      <div className="flex gap-3">
        {!restartRequested && <Button loading={restarting} onClick={async () => {
          setRestarting(true); setError('');
          try { await restartSystem(); setRestartRequested(true); }
          catch (e) { setError(e instanceof Error ? e.message : String(e)); }
          finally { setRestarting(false); }
        }}>{t('setup.restartNow')}</Button>}
        <Link to="/projects">{t('projects.title')}</Link>
      </div>
    </> : <>
      <p className="text-sm text-gray-500">{t('qq.setupHint')}</p>
      <label className="block text-sm">{t('qq.route')}
        <select aria-label={t('qq.route')} className="block w-full border rounded p-2 bg-transparent" value={kind} onChange={e => setKind(e.target.value)}>
          <option value="qq">QQ (OneBot / NapCat)</option>
          <option value="qqbot">{t('qq.official')}</option>
        </select>
      </label>
      <Input aria-label={t('qq.projectID')} label={t('qq.projectID')} value={project} onChange={e => setProject(e.target.value)} />
      <p className="text-xs text-gray-500">{t('qq.projectHint')}</p>
      {name && !validName && <p role="alert" className="text-red-500">{t('qq.invalidProject')}</p>}
      <label className="block text-sm">{t('projects.agentType')}
        <select aria-label={t('projects.agentType')} className="block w-full border rounded p-2 bg-transparent" value={selectedAgent} onChange={e => setAgent(e.target.value)}>
          {available.map(c => <option key={c.agent_type} value={c.agent_type}>{c.label} — {c.login}</option>)}
        </select>
      </label>
      {clis !== null && available.length === 0 && <p role="alert">{t('qq.noCLI')}</p>}
      <Input aria-label={t('projects.workDir')} label={t('projects.workDir')} value={workDir} onChange={e => setWorkDir(e.target.value)} />
      {validName && selectedAgent ? <PlatformManualForm key={kind} platformType={kind} projectName={name}
        workDir={workDir} agentType={selectedAgent} onComplete={() => setSaved(true)} onCancel={onBack} />
        : <Button variant="secondary" onClick={onBack}>{t('common.back')}</Button>}
    </>}
  </Card>;
}
