import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, CheckCircle2, Loader2, Play, RotateCw, ShieldCheck, XCircle, Zap } from 'lucide-react';
import { Badge, Button, Input, LoadingState, PageHeader, Section } from '@/components/ui';
import { cn } from '@/lib/utils';
import { getGateSettings, saveGate, startGate, type GateBot, type GateMode, type GateStatus } from '@/api/gate';
import { saveJev, testJev } from '@/api/wizard';
import { JevPreset, JEV_PRESET } from '@/pages/Setup/JevPreset';
import { gateTexts, type GateTexts } from './texts';

/**
 * 闸门设置 (#217): the setup wizard's step 4 (谁在什么时候接话) and step 5 (判断用的模型) as a
 * page you can come back to. Three buttons pick one way of answering; the row list says which
 * roles take part; saving writes config.toml and reloads the running roles, exactly like a wizard
 * run does, so nothing has to be reinstalled.
 *
 * The service card is honest about what it can do: a gate that is up is shown as up, one that is
 * down offers 一键启动, and a missing Python comes back as its own reason instead of a vague error.
 */
export default function GateSettingsPage() {
  const { i18n } = useTranslation();
  const T = gateTexts(i18n.language || 'en');
  const lang = i18n.language || 'en';

  const [data, setData] = useState<Awaited<ReturnType<typeof getGateSettings>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pick, setPick] = useState<GateMode | null>(null);
  const [on, setOn] = useState<Record<string, boolean>>({});
  const [saveState, setSaveState] = useState<{ saving: boolean; msg: string; err: string; notes: string[]; restart: string[] }>(
    { saving: false, msg: '', err: '', notes: [], restart: [] },
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await getGateSettings(lang);
      setData(d);
      setPick(d.mode === '' ? null : d.mode);
      setOn(Object.fromEntries(d.bots.map((b) => [b.project, b.enabled])));
      setError('');
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [lang]);

  useEffect(() => { load(); }, [load]);

  const bots = data?.bots ?? [];
  const dirty = useMemo(() => {
    if (!data || pick === null) return false;
    if (pick !== data.mode) return true;
    return bots.some((b) => (on[b.project] ?? b.enabled) !== b.enabled);
  }, [data, pick, on, bots]);

  const toggle = (b: GateBot) => setOn((m) => ({ ...m, [b.project]: !(m[b.project] ?? b.enabled) }));
  const anyTicked = bots.some((b) => on[b.project] ?? b.enabled);

  const doSave = async () => {
    if (!pick) return;
    setSaveState({ saving: true, msg: '', err: '', notes: [], restart: [] });
    try {
      const r = await saveGate({ mode: pick, bots: on, lang });
      const notes = (r.notes || []).map((n) => noteText(T, n));
      setData((d) => (d ? { ...d, bots: r.bots, gate: r.gate, mode: r.mode_current } : d));
      setPick(r.mode_current === '' ? null : r.mode_current);
      setOn(Object.fromEntries(r.bots.map((b) => [b.project, b.enabled])));
      const keys = r.restart_keys || [];
      setSaveState({ saving: false, msg: keys.length > 0 ? T.savedRestart : T.saved,
        err: r.reload_error ? `${T.reloadError} ${r.reload_error}` : '', notes, restart: keys });
    } catch (e: any) {
      setSaveState({ saving: false, msg: '', err: `${T.saveFailed}：${e?.message || e}`, notes: [], restart: [] });
    }
  };

  return (
    <div className="space-y-5 animate-fade-in" data-testid="gate-page">
      <PageHeader
        icon={ShieldCheck}
        title={T.title}
        description={T.subtitle}
        actions={
          <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
            <RotateCw size={14} className={loading ? 'animate-spin' : ''} />
            {T.refresh}
          </Button>
        }
      />

      {error && (
        <div className="rounded-card bg-surface p-4 text-sm ring-1 ring-hairline">
          <p className="font-medium text-ink">{T.loadFailed}</p>
          <p className="mt-1 break-words text-xs text-ink-mute">{error}</p>
        </div>
      )}

      {loading && !data ? (
        <LoadingState label={T.loading} />
      ) : data && (
        <>
          <Section title={T.modeTitle} description={T.modeQuestion}>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <ModeCard id="smart" icon={Zap} title={T.modeSmart} hint={T.modeSmartHint}
                active={pick === 'smart'} onClick={() => setPick('smart')} />
              <ModeCard id="addressed" icon={CheckCircle2} title={T.modeAddressed} hint={T.modeAddressedHint}
                active={pick === 'addressed'} onClick={() => setPick('addressed')} />
              <ModeCard id="off" icon={XCircle} title={T.modeOff} hint={T.modeOffHint}
                active={pick === 'off'} onClick={() => setPick('off')} />
            </div>
            {data.mode === '' && pick === null && (
              <p className="mt-3 flex items-start gap-2 text-xs text-ink-soft" data-testid="gate-mode-mixed">
                <AlertTriangle size={14} strokeWidth={1.6} className="mt-0.5 shrink-0 text-amber-600" />
                <span><span className="font-medium text-ink">{T.modeMixed}</span> {T.modeMixedHint}</span>
              </p>
            )}
          </Section>

          <Section title={T.botsTitle} description={T.botsHint}>
            <ul className="divide-y divide-hairline" data-testid="gate-bots">
              {bots.map((b) => (
                <BotRow key={b.project} b={b} T={T} lead={data.lead} on={on[b.project] ?? b.enabled} onToggle={() => toggle(b)} />
              ))}
            </ul>
            {!anyTicked && (
              <p className="mt-3 flex items-start gap-2 text-xs text-amber-600" data-testid="gate-none-ticked">
                <AlertTriangle size={14} strokeWidth={1.6} className="mt-0.5 shrink-0" />
                {T.modeOffHint}
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button data-testid="gate-save" onClick={doSave} disabled={!dirty || saveState.saving || pick === null} loading={saveState.saving}>
                {saveState.saving ? T.saving : T.save}
              </Button>
              {saveState.msg && <span className="flex items-center gap-1 text-xs text-emerald-600" data-testid="gate-saved"><Check size={13} />{saveState.msg}</span>}
              {!dirty && !saveState.msg && <span className="text-xs text-ink-mute">{T.nothingChanged}</span>}
            </div>
            {saveState.err && (
              <p className="mt-2 break-words text-xs text-red-500" data-testid="gate-save-error">{saveState.err}</p>
            )}
            {saveState.notes.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-ink-mute" data-testid="gate-save-notes">
                {saveState.notes.map((n) => <li key={n}>· {n}</li>)}
              </ul>
            )}
            {saveState.restart.length > 0 && (
              <p className="mt-2 text-xs text-amber-600" data-testid="gate-restart">
                {T.restartNeeded} <code className="rounded bg-surface-sunken px-1.5 py-0.5">{saveState.restart.join(' · ')}</code>
              </p>
            )}
          </Section>

          <GateServiceCard T={T} lang={lang} gate={data.gate} onRefresh={load} />

          <JevCard T={T} lang={lang} lead={data.lead} jev={data.jev} hint={data.jev_hint} onSaved={load} />
        </>
      )}
    </div>
  );
}

/** A note from the server ("custom gate kept") in the reader's language. */
function noteText(T: GateTexts, note: string): string {
  if (note.includes('custom gate')) return `${note.split(':')[0]} · ${T.customGateHint}`;
  return note;
}

function ModeCard({ id, icon: Icon, title, hint, active, onClick }: {
  id: string; icon: typeof Zap; title: string; hint: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={`gate-mode-${id}`}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex h-full flex-col items-start gap-2 rounded-card p-4 text-left ring-1 transition-colors duration-base ease-ui-out',
        active ? 'bg-accent-wash ring-accent/40' : 'bg-surface-sunken ring-hairline hover:bg-accent-wash/60',
      )}
    >
      <span className="flex items-center gap-2">
        <Icon size={16} strokeWidth={1.6} className={active ? 'text-accent' : 'text-ink-soft'} />
        <span className={cn('text-sm font-medium', active ? 'text-ink' : 'text-ink-soft')}>{title}</span>
      </span>
      <span className="text-xs leading-relaxed text-ink-mute">{hint}</span>
    </button>
  );
}

function BotRow({ b, T, lead, on, onToggle }: { b: GateBot; T: GateTexts; lead: string; on: boolean; onToggle: () => void }) {
  const now = b.mode === 'smart' ? T.nowSmart : b.mode === 'addressed' ? T.nowAddressed : T.nowOff;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3" data-testid={`gate-bot-${b.project}`}>
      <div className="flex min-w-0 items-center gap-3">
        <input
          type="checkbox"
          checked={on}
          onChange={onToggle}
          aria-label={`${T.joinGate} · ${b.name}`}
          data-testid={`gate-bot-${b.project}-toggle`}
          className="h-4 w-4 shrink-0 accent-accent"
        />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-ink">{b.name}</span>
            {b.project === lead && <Badge variant="info">{T.leadBadge}</Badge>}
            {b.custom_gate && <Badge variant="warning">{T.customGate}</Badge>}
          </div>
          <p className="mt-0.5 text-xs text-ink-mute">
            <code className="text-[11px]">{b.project}</code> · {b.platforms.join(' / ')} · {b.listens ? T.hearsAll : T.hearsAddressed}
          </p>
        </div>
      </div>
      <Badge variant={on ? (b.mode === 'off' ? 'warning' : 'success') : 'outline'}>{now}</Badge>
    </li>
  );
}

function statusVariant(status: string) {
  if (status === 'running') return 'success' as const;
  if (status === 'starting') return 'warning' as const;
  if (status === 'off') return 'outline' as const;
  return 'danger' as const;
}

function statusText(T: GateTexts, status: string) {
  switch (status) {
    case 'running': return T.statusRunning;
    case 'starting': return T.statusStarting;
    case 'off': return T.statusOff;
    case 'python_missing': return T.statusPythonMissing;
    case 'python_too_old': return T.statusPythonTooOld;
    default: return status;
  }
}

function GateServiceCard({ T, lang, gate, onRefresh }: { T: GateTexts; lang: string; gate: GateStatus; onRefresh: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [reason, setReason] = useState('');

  const start = async () => {
    setBusy(true); setMsg(''); setReason('');
    try {
      const r = await startGate(lang);
      if (r.started) { setMsg(T.started); onRefresh(); }
      else if (r.reason === 'not_managed') setReason(T.startNotManaged);
      else if (r.reason) setReason(`${T.startFailed}：${statusText(T, r.reason)}`);
    } catch (e: any) {
      setReason(`${T.startFailed}：${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title={T.serviceTitle}
      actions={<span data-testid="gate-service-status"><Badge variant={statusVariant(gate.status)}>{statusText(T, gate.status)}</Badge></span>}
    >
      <p className="text-xs leading-relaxed text-ink-soft">{gate.hint}</p>
      <p className="mt-1 text-[11px] text-ink-mute">
        <code>{gate.addr}</code>
        {gate.url && <> · <code className="break-all">{gate.url}</code></>}
      </p>
      {!gate.running && gate.wanted && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button size="sm" variant="secondary" onClick={start} disabled={busy} data-testid="gate-service-start">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {busy ? T.starting : T.start}
          </Button>
          {msg && <span className="flex items-center gap-1 text-xs text-emerald-600"><Check size={13} />{msg}</span>}
          {reason && <span className="break-words text-xs text-amber-600" data-testid="gate-service-reason">{reason}</span>}
        </div>
      )}
      {!gate.wanted && <p className="mt-2 text-xs text-ink-mute">{T.statusOff}</p>}
    </Section>
  );
}

function JevCard({ T, lang, lead, jev, hint, onSaved }: {
  T: GateTexts; lang: string; lead: string;
  jev?: { url: string; model: string; has_key: boolean };
  hint: string;
  onSaved: () => void;
}) {
  const [url, setURL] = useState(jev?.url ?? '');
  const [key, setKey] = useState('');
  const [model, setModel] = useState(jev?.model ?? '');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<{ usable?: boolean; reason?: string; in_use?: string }>({});
  const [msg, setMsg] = useState('');

  // 改过地址/模型就得重新测：一个测过又改掉的配置，存下去等于没测。
  const edited = () => { setTest({}); setMsg(''); };
  const canSave = test.usable === true && !saving;

  const doTest = async () => {
    setTesting(true); setTest({}); setMsg('');
    try {
      const r = await testJev({ base_url: url.trim(), api_key: key.trim() || undefined, model: model.trim(), lang, fallback_name: lead });
      setTest({ usable: r.usable, reason: r.reason, in_use: r.in_use });
    } catch (e: any) {
      setTest({ usable: false, reason: e?.message || String(e) });
    } finally {
      setTesting(false);
    }
  };

  const doSave = async () => {
    setSaving(true); setMsg('');
    try {
      const r = await saveJev({ base_url: url.trim(), api_key: key.trim() || undefined, model: model.trim(), lang, fallback_name: lead });
      if (r.saved) { setMsg(T.jevSaved); setKey(''); onSaved(); }
      else setTest({ usable: false, reason: r.reason });
    } catch (e: any) {
      setTest({ usable: false, reason: e?.message || String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title={T.jevTitle} description={T.jevHint}>
      {jev && (
        <p className="mb-3 text-xs text-ink-soft" data-testid="jev-current">
          {T.jevInUse} <code>{jev.model}</code> @ <code className="break-all">{jev.url}</code>
          {' · '}{jev.has_key ? 'key ✓' : T.jevNoKey}
        </p>
      )}
      {!jev && (
        <div className="mb-3">
          <JevPreset lang={lang} active={url === JEV_PRESET.base_url && model === JEV_PRESET.model}
            onFill={() => { setURL(JEV_PRESET.base_url); setModel(JEV_PRESET.model); setKey(''); edited(); }} />
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input label={T.jevURL} value={url} placeholder={JEV_PRESET.base_url} data-testid="gate-jev-url"
          onChange={(e) => { setURL(e.target.value); edited(); }} />
        <Input label={T.jevKey} type="password" value={key} placeholder="sk-…" data-testid="gate-jev-key"
          onChange={(e) => { setKey(e.target.value); edited(); }} />
        <Input label={T.jevModel} value={model} placeholder={JEV_PRESET.model} data-testid="gate-jev-model"
          onChange={(e) => { setModel(e.target.value); edited(); }} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" variant="secondary" onClick={doTest} disabled={testing || !url.trim() || !model.trim()} data-testid="gate-jev-test">
          {testing ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
          {testing ? T.jevTesting : T.jevTest}
        </Button>
        <Button size="sm" onClick={doSave} disabled={!canSave} loading={saving} data-testid="gate-jev-save">
          {saving ? T.saving : T.jevSave}
        </Button>
        {test.usable === true && <span className="flex items-center gap-1 text-xs text-emerald-600" data-testid="gate-jev-ok"><CheckCircle2 size={13} />{T.jevOK}</span>}
        {test.usable === false && <span className="flex items-center gap-1 text-xs text-red-500" data-testid="gate-jev-fail"><XCircle size={13} />{test.reason || T.jevFail}</span>}
        {test.usable === undefined && !testing && <span className="text-xs text-ink-mute">{T.jevNeedTest}</span>}
        {msg && <span className="flex items-center gap-1 text-xs text-emerald-600" data-testid="gate-jev-saved"><Check size={13} />{msg}</span>}
      </div>
      <p className="mt-2 text-xs text-ink-mute">{hint}</p>
    </Section>
  );
}
