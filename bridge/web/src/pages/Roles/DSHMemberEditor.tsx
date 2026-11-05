import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Modal, Textarea } from '@/components/ui';
import { createDSHMember, updateDSHMember, getDSHCliOptions, getDSHModelRoutes, type DSHCli, type DSHCliOptions, type DSHManagedMember, type DSHMemberInput, type DSHModelRoute } from '@/api/dsh';
import { errorMessage } from '@/components/DSHNotice';

const field = 'w-full rounded-control border border-hairline bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent-text disabled:opacity-60';

export function DSHMemberEditor({ member, onClose, onSaved }: { member: DSHManagedMember | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(member?.name ?? '');
  const [persona, setPersona] = useState(member?.persona ?? '');
  const [cli, setCli] = useState<DSHCli | ''>(member?.cli ?? '');
  const [provider, setProvider] = useState(member?.model?.provider ?? '');
  const [model, setModel] = useState(member?.model?.model ?? '');
  const [cliModel, setCliModel] = useState(member?.cliConfig?.model ?? '');
  const [effort, setEffort] = useState(member?.cliConfig?.reasoningEffort ?? '');
  const [routes, setRoutes] = useState<DSHModelRoute[] | null>(null);
  const [options, setOptions] = useState<DSHCliOptions | null>(null);
  const [routeError, setRouteError] = useState('');
  const [optionError, setOptionError] = useState('');
  const [probing, setProbing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [configChanged, setConfigChanged] = useState(false);
  const probeId = useRef(0);

  useEffect(() => {
    let alive = true;
    getDSHModelRoutes().then(r => { if (alive) setRoutes(r.routes); }).catch(e => { if (alive) setRouteError(errorMessage(e)); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    const id = ++probeId.current;
    if (cli !== 'codex') { setOptions(null); setProbing(false); return; }
    setProbing(true); setOptionError(''); setOptions(null);
    getDSHCliOptions({ cli: 'codex', ...(member?.cli === 'codex' ? { memberId: member.id } : {}), ...(cliModel ? { model: cliModel } : {}) })
      .then(r => { if (probeId.current === id) setOptions(r); })
      .catch(e => { if (probeId.current === id) setOptionError(errorMessage(e)); })
      .finally(() => { if (probeId.current === id) setProbing(false); });
    return () => { probeId.current++; };
  }, [cli, cliModel, member]);

  const route = routes?.find(r => r.provider === provider);
  const validConfig = !configChanged || cli !== 'codex' || (!probing && !optionError && !!options?.supported && (!cliModel || !!options.model?.options.some(o => o.value === cliModel)) && (!effort || !!options.reasoningEffort?.options.some(o => o.value === effort)));
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !validConfig) return;
    const body: DSHMemberInput = { name: name.trim(), persona, cli: cli || null };
    if (!cli) body.model = provider && model ? { provider, model } : null;
    if (cli === 'codex' && (!member || member.cli !== cli || configChanged)) body.cliConfig = cliModel || effort ? { model: cliModel || null, reasoningEffort: effort || null } : null;
    setSaving(true); setError('');
    try {
      if (member) await updateDSHMember(member.id, body); else await createDSHMember(body);
      onSaved();
    } catch (e) { setError(errorMessage(e)); } finally { setSaving(false); }
  };
  return <Modal open onClose={onClose} title={member ? t('dshManage.edit') : t('dshManage.add')} className="max-h-[90vh] overflow-y-auto">
    <form className="space-y-4" onSubmit={save}>
      <label className="block text-sm text-ink-soft">{t('dshManage.name')}<Input aria-label={t('dshManage.name')} required value={name} onChange={e => setName(e.target.value)} /></label>
      <label className="block space-y-1 text-sm text-ink-soft">{t('dshManage.type')}
        <select className={field} value={cli} onChange={e => { setCli(e.target.value as DSHCli | ''); setConfigChanged(false); setCliModel(''); setEffort(''); setProvider(''); setModel(''); }}>
          <option value="">DSH</option><option value="codex">Codex CLI</option><option value="claude">Claude CLI</option><option value="gemini">Gemini CLI</option>
        </select>
      </label>
      <label className="block text-sm text-ink-soft">{t('dshManage.persona')}<Textarea aria-label={t('dshManage.persona')} rows={3} value={persona} onChange={e => setPersona(e.target.value)} /></label>
      {!cli && <div className="space-y-3">
        <p className="text-xs text-ink-mute">{t('dshManage.nativeHint')}</p>
        {routeError && <p role="alert" className="text-sm text-red-600">{routeError}</p>}
        {!routes && !routeError && <p role="status">{t('common.loading')}</p>}
        {routes && routes.length === 0 && <p>{t('dshManage.noRoutes')}</p>}
        {routes?.map(r => r.error && <p key={r.provider} role="alert" className="text-sm text-red-600">{r.name}: {r.error}</p>)}
        <label className="block space-y-1 text-sm text-ink-soft">{t('dshManage.provider')}<select className={field} disabled={!routes} value={provider} onChange={e => { setProvider(e.target.value); setModel(''); }}>
          <option value="">{t('dshManage.defaultRoute')}</option>{routes?.map(r => <option key={r.provider} value={r.provider}>{r.name}</option>)}{provider && !route && <option value={provider}>{provider}</option>}
        </select></label>
        {provider && <label className="block space-y-1 text-sm text-ink-soft">{t('dshManage.model')}<select className={field} required value={model} onChange={e => setModel(e.target.value)}>
          <option value="">{t('dshManage.chooseModel')}</option>{route?.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}{model && !route?.models.some(m => m.id === model) && <option value={model}>{model}</option>}
        </select></label>}
      </div>}
      {cli === 'codex' && <div className="space-y-3">
        <p className="text-xs text-ink-mute">{t('dshManage.codexHint')}</p>
        {probing && <p role="status">{t('dshManage.probing')}</p>}
        {optionError && <p role="alert" className="text-sm text-red-600">{optionError}</p>}
        {options && !options.supported && <p>{t('dshManage.unsupported')}</p>}
        {options?.error && <p role="alert">{options.error}</p>}
        <label className="block space-y-1 text-sm text-ink-soft">{t('dshManage.model')}<select className={field} disabled={!options?.supported || probing} value={cliModel} onChange={e => { setCliModel(e.target.value); setEffort(''); setConfigChanged(true); }}>
          <option value="">{t('dshManage.inherit')}</option>{options?.model?.options.map(o => <option key={o.value} value={o.value}>{o.name}</option>)}{cliModel && !options?.model?.options.some(o => o.value === cliModel) && <option value={cliModel}>{cliModel}</option>}
        </select></label>
        <label className="block space-y-1 text-sm text-ink-soft">{t('dshManage.effort')}<select className={field} disabled={!options?.supported || probing || !options.reasoningEffort} value={effort} onChange={e => { setEffort(e.target.value); setConfigChanged(true); }}>
          <option value="">{t('dshManage.inherit')}</option>{options?.reasoningEffort?.options.map(o => <option key={o.value} value={o.value}>{o.name}</option>)}{effort && !options?.reasoningEffort?.options.some(o => o.value === effort) && <option value={effort}>{effort}</option>}
        </select></label>
      </div>}
      {cli && cli !== 'codex' && <p className="text-xs text-ink-mute">{t('dshManage.cliHint')}</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" disabled={saving || !name.trim() || !validConfig || (!!provider && !model)}>{saving ? t('common.loading') : t('common.save')}</Button></div>
    </form>
  </Modal>;
}
