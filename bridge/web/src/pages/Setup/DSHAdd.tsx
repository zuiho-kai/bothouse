import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';
import { getDSHStatus, type DSHStatus } from '@/api/wizard';
import { errorMessage } from '@/components/DSHNotice';
import { DSHMemberEditor } from '@/pages/Roles/DSHMemberEditor';
import DSHSetup from './DSHSetup';

export default function DSHAdd({ lang, onBack }: { lang: string; onBack: () => void }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<DSHStatus | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(true);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let alive = true;
    getDSHStatus(lang).then(s => { if (alive) setStatus(s); }).catch(e => { if (alive) setError(errorMessage(e)); });
    return () => { alive = false; };
  }, [lang]);
  if (error) return <div className="space-y-3"><p role="alert">{error}</p><Button variant="secondary" onClick={onBack}>{t('common.back')}</Button></div>;
  if (!status) return <p role="status">{t('common.loading')}</p>;
  if (!status.found || !status.plugin_installed) return <DSHSetup lang={lang} onBack={onBack} />;
  return <div className="space-y-4">
    <h1 className="text-xl font-semibold">{t('dshManage.add')}</h1>
    {saved && <p role="status">{t('dshManage.saved')}</p>}
    <div className="flex flex-wrap gap-2"><Button onClick={() => setOpen(true)}>{t('dshManage.add')}</Button><Link className="text-accent-text underline" to="/roles">{t('roles.title')}</Link><Button variant="secondary" onClick={onBack}>{t('common.back')}</Button></div>
    {open && <DSHMemberEditor member={null} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); setSaved(true); window.dispatchEvent(new CustomEvent('cc:refresh')); }} />}
  </div>;
}
