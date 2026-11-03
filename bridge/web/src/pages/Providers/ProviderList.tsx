import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plug, Plus, Trash2, Pencil, ExternalLink, Star, Sparkles, X, Eye, EyeOff, Check,
  Download,
} from 'lucide-react';
import { Card, Button, Badge, Modal, Input, PageHeader, EmptyState, LoadingState } from '@/components/ui';
import {
  listGlobalProviders, addGlobalProvider, updateGlobalProvider, removeGlobalProvider,
  fetchProviderPresets, listCCSwitchProviders, importCCSwitchProviders,
  type GlobalProvider, type ProviderPreset, type ProviderModel, type CCSwitchProvider,
} from '@/api/providers';
import { cn } from '@/lib/utils';

type Tab = 'providers' | 'presets';

export default function ProviderList() {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<Tab>('providers');
  const [providers, setProviders] = useState<GlobalProvider[]>([]);
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [presetsLoading, setPresetsLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editProvider, setEditProvider] = useState<GlobalProvider | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [showCCSwitchModal, setShowCCSwitchModal] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listGlobalProviders();
      setProviders(data.providers || []);
    } catch { /* empty */ }
    setLoading(false);
  }, []);

  const loadPresets = useCallback(async () => {
    setPresetsLoading(true);
    try {
      const data = await fetchProviderPresets();
      setPresets(data.providers || []);
    } catch { /* empty */ }
    setPresetsLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (tab === 'presets' && presets.length === 0) loadPresets();
  }, [tab, presets.length, loadPresets]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await removeGlobalProvider(deleteTarget);
      await refresh();
    } catch { /* empty */ }
    setDeleteTarget(null);
  };

  const handleAddFromPreset = (preset: ProviderPreset) => {
    const agentTypes = Object.keys(preset.agents || {});
    const firstAt = agentTypes[0] || 'claudecode';
    const firstAc = preset.agents?.[firstAt];

    const endpoints: Record<string, string> = {};
    const agentModels: Record<string, string> = {};
    const agentModelLists: Record<string, ProviderModel[]> = {};
    let codex: GlobalProvider['codex'];

    for (const [at, cfg] of Object.entries(preset.agents || {})) {
      if (at !== firstAt && cfg.base_url) endpoints[at] = cfg.base_url;
      if (at !== firstAt && cfg.model) agentModels[at] = cfg.model;
      const models = cfg.models?.map(m => ({ model: m }));
      if (models?.length && at !== firstAt) agentModelLists[at] = models;
      if (at === firstAt && models?.length) { /* stored in top-level */ }
      if (at === 'codex' && cfg.codex_config?.wire_api) {
        codex = { wire_api: cfg.codex_config.wire_api, http_headers: cfg.codex_config.http_headers };
      }
    }

    setEditProvider({
      name: preset.name,
      base_url: firstAc?.base_url || '',
      model: firstAc?.model || '',
      thinking: preset.thinking || '',
      models: firstAc?.models?.map(m => ({ model: m })),
      agent_types: agentTypes,
      endpoints: Object.keys(endpoints).length ? endpoints : undefined,
      agent_models: Object.keys(agentModels).length ? agentModels : undefined,
      agent_model_lists: Object.keys(agentModelLists).length ? agentModelLists : undefined,
      codex,
      _preset: preset,
    } as any);
    setShowAddModal(true);
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        icon={Plug}
        title={t('globalProviders.title')}
        description={t('globalProviders.subtitle')}
        actions={
          <>
            <Button variant="secondary" onClick={() => setShowCCSwitchModal(true)}>
              <Download size={16} /> {t('globalProviders.importCCSwitch')}
            </Button>
            <Button onClick={() => { setEditProvider(null); setShowAddModal(true); }}>
              <Plus size={16} /> {t('globalProviders.add')}
            </Button>
          </>
        }
      />

      {/* Tabs ride the sunken track with a raised pill: the same ladder the sidebar uses. */}
      <div className="flex w-fit gap-1 rounded-control bg-surface-sunken p-1 ring-1 ring-hairline">
        {(['providers', 'presets'] as const).map(key => (
          <button
            key={key}
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
            className={cn(
              'rounded-control px-4 py-1.5 text-sm font-medium transition-[background-color,color,box-shadow] duration-base ease-ui-out',
              tab === key
                ? 'bg-surface text-ink ring-1 ring-hairline'
                : 'text-ink-soft hover:text-ink',
            )}
          >
            {t(`globalProviders.tab.${key}`)}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === 'providers' && (
        <ProviderGrid
          providers={providers}
          loading={loading}
          onEdit={p => { setEditProvider(p); setShowAddModal(true); }}
          onDelete={name => setDeleteTarget(name)}
          t={t}
        />
      )}
      {tab === 'presets' && (
        <PresetGrid
          presets={presets}
          loading={presetsLoading}
          existingNames={new Set(providers.map(p => p.name))}
          onAdd={handleAddFromPreset}
          onRefresh={loadPresets}
          t={t}
          lang={i18n.language || 'en'}
        />
      )}

      {/* Add/Edit Modal */}
      {showAddModal && (
        <ProviderFormModal
          provider={editProvider}
          onClose={() => setShowAddModal(false)}
          onSave={async (p) => {
            if (editProvider?.name && providers.some(x => x.name === editProvider.name)) {
              await updateGlobalProvider(editProvider.name, p);
            } else {
              await addGlobalProvider(p);
            }
            setShowAddModal(false);
            await refresh();
          }}
          t={t}
        />
      )}

      {/* Delete confirm */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title={t('common.confirmDelete')}>
        <p className="text-sm text-ink-soft mb-4">
          {t('globalProviders.deleteHint', { name: deleteTarget })}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</Button>
          <Button variant="danger" onClick={handleDelete}>{t('common.delete')}</Button>
        </div>
      </Modal>

      {showCCSwitchModal && (
        <CCSwitchImportModal
          existingNames={new Set(providers.map(p => p.name))}
          onClose={() => setShowCCSwitchModal(false)}
          onImported={refresh}
          t={t}
        />
      )}
    </div>
  );
}

/* ── Provider Grid ── */

function ProviderGrid({
  providers, loading, onEdit, onDelete, t,
}: {
  providers: GlobalProvider[];
  loading: boolean;
  onEdit: (p: GlobalProvider) => void;
  onDelete: (name: string) => void;
  t: (k: string) => string;
}) {
  if (loading) return <LoadingState label={t('common.loading')} />;
  if (providers.length === 0) {
    return <EmptyState icon={Plug} message={t('globalProviders.empty')} hint={t('globalProviders.emptyHint')} />;
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {providers.map(p => (
        <Card key={p.name} className="group relative hover:ring-hairline-strong">
          <div className="flex items-start justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Plug size={16} className="text-ink-mute shrink-0" />
                <h3 className="font-medium text-ink truncate">{p.name}</h3>
              </div>
              {p.base_url && (
                <p className="mt-1 text-xs text-ink-mute truncate">{p.base_url}</p>
              )}
              {p.model && (
                <Badge className="mt-2">{p.model}</Badge>
              )}
              {p.models && p.models.length > 0 && (
                <ModelBadges models={p.models.map(m => m.alias || m.model)} limit={3} />
              )}
              {p.agent_types && p.agent_types.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.agent_types.map(a => (
                    <Badge key={a} variant="info" className="text-xs">{a}</Badge>
                  ))}
                </div>
              )}
              {p.thinking && (
                <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">thinking: {p.thinking}</p>
              )}
            </div>
            <div className="flex gap-1 ring-1 ring-hairline rounded-control bg-surface/85 backdrop-blur-sm transition-opacity duration-base md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
              <button
                onClick={() => onEdit(p)}
                aria-label={`${t('globalProviders.edit')} ${p.name}`}
                className="grid h-11 w-11 place-items-center rounded-control text-ink-mute hover:bg-surface-sunken hover:text-ink md:h-8 md:w-8"
              >
                <Pencil size={14} />
              </button>
              <button
                onClick={() => onDelete(p.name)}
                aria-label={`${t('common.delete')} ${p.name}`}
                className="grid h-11 w-11 place-items-center rounded-control text-ink-mute hover:bg-red-500/10 hover:text-red-500 md:h-8 md:w-8"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

/* ── Presets Grid ── */

function PresetGrid({
  presets, loading, existingNames, onAdd, onRefresh, t, lang,
}: {
  presets: ProviderPreset[];
  loading: boolean;
  existingNames: Set<string>;
  onAdd: (p: ProviderPreset) => void;
  onRefresh: () => void;
  t: (k: string, opts?: any) => string;
  lang: string;
}) {
  if (loading) return <LoadingState label={t('common.loading')} />;
  if (presets.length === 0) {
    return (
      <div>
        <EmptyState icon={Sparkles} message={t('globalProviders.noPresets')} hint={t('globalProviders.noPresetsHint')} />
        <div className="flex justify-center">
          <Button variant="ghost" onClick={onRefresh}>{t('common.refresh')}</Button>
        </div>
      </div>
    );
  }
  const sorted = [...presets].sort((a, b) => a.tier - b.tier);
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {sorted.map(p => {
        const added = existingNames.has(p.name);
        return (
          <Card key={p.name} className="relative overflow-hidden flex flex-col">
            {p.featured && (
              <div className="absolute top-0 right-0 bg-amber-400/90 text-white text-[10px] font-bold px-2 py-0.5 rounded-bl-lg">
                <Star size={10} className="inline mr-0.5 -mt-0.5" />
              </div>
            )}
            <div className="space-y-3 flex-1">
              <div>
                <h3 className="font-medium text-ink">{p.display_name || p.name}</h3>
                {(p.description || p.description_zh) && (
                  <p className="mt-1 text-xs text-ink-soft line-clamp-2">
                    {lang.startsWith('zh') && p.description_zh ? p.description_zh : p.description}
                  </p>
                )}
              </div>
              {p.agents && Object.keys(p.agents).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {Object.keys(p.agents).map(a => (
                    <Badge key={a} variant="info" className="text-xs">{a}</Badge>
                  ))}
                </div>
              )}
              {p.features && p.features.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {p.features.map(f => (
                    <Badge key={f} variant="outline" className="text-xs">{f}</Badge>
                  ))}
                </div>
              )}
              {(() => {
                const firstAc = p.agents?.[Object.keys(p.agents || {})[0]];
                return firstAc?.models && firstAc.models.length > 0 ? (
                  <ModelBadges models={firstAc.models} limit={5} />
                ) : null;
              })()}
            </div>
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-hairline dark:border-white/[0.06]">
              {p.invite_url ? (
                <a
                  href={p.invite_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-accent hover:underline inline-flex items-center gap-1"
                >
                  {t('globalProviders.register')} <ExternalLink size={11} />
                </a>
              ) : <span />}
              <Button
                size="sm"
                variant={added ? 'ghost' : 'primary'}
                disabled={added}
                onClick={() => onAdd(p)}
              >
                {added ? t('globalProviders.added') : t('globalProviders.addPreset')}
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/* ── Model Badges (collapsible) ── */

function ModelBadges({ models, limit = 3 }: { models: string[]; limit?: number }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? models : models.slice(0, limit);
  const remaining = models.length - limit;

  return (
    <div className="mt-2 flex flex-wrap gap-1 items-center">
      {visible.map(m => (
        <Badge key={m} variant="outline" className="text-xs">{m}</Badge>
      ))}
      {remaining > 0 && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="text-[11px] text-accent hover:underline"
        >
          +{remaining} more
        </button>
      )}
      {expanded && remaining > 0 && (
        <button
          onClick={() => setExpanded(false)}
          className="text-[11px] text-ink-mute hover:text-ink-soft hover:underline"
        >
          less
        </button>
      )}
    </div>
  );
}

/* ── Model List Editor ── */

function ModelListEditor({
  models, onChange, defaultModel, onSetDefault,
}: {
  models: ProviderModel[];
  onChange: (models: ProviderModel[]) => void;
  defaultModel?: string;
  onSetDefault?: (model: string) => void;
}) {
  const [input, setInput] = useState('');

  const addModel = () => {
    const name = input.trim();
    if (!name || models.some(m => m.model === name)) return;
    onChange([...models, { model: name }]);
    setInput('');
  };

  const removeModel = (model: string) => {
    onChange(models.filter(m => m.model !== model));
  };

  return (
    <div className="space-y-2">
      {models.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {models.map(m => {
            const isDefault = defaultModel === m.model;
            return (
              <span
                key={m.model}
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs transition-colors',
                  isDefault
                    ? 'bg-accent/15 text-accent border border-accent/30'
                    : 'bg-surface-sunken text-ink-soft hover:bg-hairline-strong',
                )}
              >
                {onSetDefault && !isDefault && (
                  <button
                    type="button"
                    onClick={() => onSetDefault(m.model)}
                    className="text-ink-mute hover:text-accent transition-colors"
                    title="Set as default"
                  >
                    <Check size={12} />
                  </button>
                )}
                {isDefault && <Check size={12} className="text-accent" />}
                {m.model}
                <button
                  type="button"
                  onClick={() => removeModel(m.model)}
                  className="text-ink-mute hover:text-red-500 transition-colors"
                >
                  <X size={12} />
                </button>
              </span>
            );
          })}
        </div>
      )}
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addModel(); } }}
          placeholder="model-name"
          className="flex-1"
        />
        <Button type="button" variant="ghost" size="sm" onClick={addModel} disabled={!input.trim()}>
          <Plus size={14} />
        </Button>
      </div>
    </div>
  );
}

/* ── Per-agent config type (internal form state) ── */

type AgentConfigEntry = { base_url: string; model: string; models: ProviderModel[]; wire_api?: string };

function buildPerAgentConfigs(form: GlobalProvider): Record<string, AgentConfigEntry> {
  const agents = form.agent_types || [];
  const result: Record<string, AgentConfigEntry> = {};
  for (const at of agents) {
    result[at] = {
      base_url: form.endpoints?.[at] || form.base_url || '',
      model: form.agent_models?.[at] || form.model || '',
      models: form.agent_model_lists?.[at] || form.models || [],
      wire_api: at === 'codex' ? form.codex?.wire_api || '' : undefined,
    };
  }
  return result;
}

function mergePerAgentToForm(form: GlobalProvider, configs: Record<string, AgentConfigEntry>): GlobalProvider {
  const agents = Object.keys(configs);
  if (agents.length === 0) return form;

  const first = agents[0];
  const base = configs[first];
  const endpoints: Record<string, string> = {};
  const agentModels: Record<string, string> = {};
  const agentModelLists: Record<string, ProviderModel[]> = {};
  let codex: GlobalProvider['codex'];

  for (const at of agents) {
    const cfg = configs[at];
    if (at !== first) {
      if (cfg.base_url && cfg.base_url !== base.base_url) endpoints[at] = cfg.base_url;
      if (cfg.model && cfg.model !== base.model) agentModels[at] = cfg.model;
      const modelsStr = JSON.stringify(cfg.models);
      const baseModelsStr = JSON.stringify(base.models);
      if (cfg.models.length > 0 && modelsStr !== baseModelsStr) agentModelLists[at] = cfg.models;
    }
    if (at === 'codex' && cfg.wire_api) {
      codex = { wire_api: cfg.wire_api };
    }
  }

  return {
    ...form,
    base_url: base.base_url,
    model: base.model,
    models: base.models.length > 0 ? base.models : undefined,
    endpoints: Object.keys(endpoints).length ? endpoints : undefined,
    agent_models: Object.keys(agentModels).length ? agentModels : undefined,
    agent_model_lists: Object.keys(agentModelLists).length ? agentModelLists : undefined,
    codex: codex || undefined,
  };
}

/* ── Per-agent config editor ── */

function AgentConfigEditor({
  agentType, config, onChange, t,
}: {
  agentType: string;
  config: AgentConfigEntry;
  onChange: (cfg: AgentConfigEntry) => void;
  t: (k: string) => string;
}) {
  return (
    <div className="space-y-3 pt-2">
      <div>
        <label className="block text-xs font-medium text-ink-soft mb-1">
          {t('globalProviders.form.baseUrl')}
        </label>
        <Input
          value={config.base_url}
          onChange={e => onChange({ ...config, base_url: e.target.value })}
          placeholder="https://api.example.com/v1"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-ink-soft mb-1">
          {t('globalProviders.form.model')}
        </label>
        <Input
          value={config.model}
          onChange={e => onChange({ ...config, model: e.target.value })}
          placeholder="model-name"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-ink-soft mb-1">
          {t('globalProviders.form.models')}
        </label>
        <ModelListEditor
          models={config.models}
          onChange={models => onChange({ ...config, models })}
          defaultModel={config.model}
          onSetDefault={model => onChange({ ...config, model })}
        />
      </div>
      {agentType === 'codex' && (
        <div>
          <label className="block text-xs font-medium text-ink-soft mb-1">
            {t('globalProviders.form.codexWireApi')}
          </label>
          <select
            value={config.wire_api || ''}
            onChange={e => onChange({ ...config, wire_api: e.target.value || undefined })}
            className={cn(
              'w-full rounded-card border px-3 py-2 text-sm outline-none transition-colors',
              'bg-surface text-ink ring-1 ring-hairline hover:ring-hairline-strong',
              'focus:outline-none focus:ring-2 focus:ring-accent-text focus:ring-offset-2 focus:ring-offset-canvas',
            )}
          >
            <option value="">default</option>
            <option value="responses">responses</option>
            <option value="chat">chat</option>
          </select>
        </div>
      )}
    </div>
  );
}

/* ── Add/Edit Form Modal ── */

function ProviderFormModal({
  provider, onClose, onSave, t,
}: {
  provider: GlobalProvider | null;
  onClose: () => void;
  onSave: (p: GlobalProvider) => Promise<void>;
  t: (k: string) => string;
}) {
  const isEdit = !!provider?.name;
  const [form, setForm] = useState<GlobalProvider>(provider || { name: '' });
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [perAgent, setPerAgent] = useState<Record<string, AgentConfigEntry>>(() =>
    provider ? buildPerAgentConfigs(provider) : {},
  );
  const [activeAgentTab, setActiveAgentTab] = useState<string>('');

  const agents = form.agent_types || [];
  const multiAgent = agents.length >= 2;

  const updatePerAgent = (at: string, cfg: AgentConfigEntry) => {
    setPerAgent(prev => ({ ...prev, [at]: cfg }));
  };

  const set = (key: keyof GlobalProvider, value: any) => {
    setForm(f => {
      const next = { ...f, [key]: value };
      if (key === 'agent_types') {
        const newAgents = value as string[];
        setPerAgent(prev => {
          const updated = { ...prev };
          for (const at of newAgents) {
            if (!updated[at]) {
              updated[at] = { base_url: f.base_url || '', model: f.model || '', models: [...(f.models || [])] };
              if (at === 'codex') updated[at].wire_api = f.codex?.wire_api || '';
            }
          }
          for (const at of Object.keys(updated)) {
            if (!newAgents.includes(at)) delete updated[at];
          }
          return updated;
        });
        if (newAgents.length >= 2 && !newAgents.includes(activeAgentTab)) {
          setActiveAgentTab(newAgents[0]);
        }
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!form.name) return;
    setSaving(true);
    try {
      const final = multiAgent ? mergePerAgentToForm(form, perAgent) : form;
      await onSave(final);
    } catch { /* empty */ }
    setSaving(false);
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? t('globalProviders.edit') : t('globalProviders.add')}>
      <div className="space-y-5">
        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-ink-soft mb-1">
              {t('globalProviders.form.name')} *
            </label>
            <Input
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="e.g. minimaxi"
              disabled={isEdit}
            />
          </div>

          {/* API Key */}
          <div>
            <label className="block text-sm font-medium text-ink-soft mb-1">
              API Key
            </label>
            <div className="relative">
              <Input
                type={showKey ? 'text' : 'password'}
                value={form.api_key || ''}
                onChange={e => set('api_key', e.target.value)}
                placeholder="sk-..."
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-mute hover:text-ink-soft"
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Agent Types */}
          <div>
            <label className="block text-sm font-medium text-ink-soft mb-1">
              {t('globalProviders.form.agentTypes')}
            </label>
            <div className="flex flex-wrap gap-2">
              {['claudecode', 'codex', 'gemini', 'opencode', 'cursor', 'kimi', 'qoder', 'acp'].map(at => {
                const selected = agents.includes(at);
                return (
                  <button
                    key={at}
                    type="button"
                    onClick={() => {
                      set('agent_types', selected ? agents.filter(x => x !== at) : [...agents, at]);
                    }}
                    className={cn(
                      'px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors',
                      selected
                        ? 'bg-accent/10 text-accent border-accent/30'
                        : 'bg-transparent text-ink-mute border-hairline hover:border-hairline-strong',
                    )}
                  >
                    {at}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-ink-mute">{t('globalProviders.form.agentTypesHint')}</p>
          </div>

          {/* Base URL / Model / Models — flat when <= 1 agent, tabbed when >= 2 */}
          {!multiAgent ? (
            <>
              <div>
                <label className="block text-sm font-medium text-ink-soft mb-1">
                  {t('globalProviders.form.baseUrl')}
                </label>
                <Input
                  value={form.base_url || ''}
                  onChange={e => set('base_url', e.target.value)}
                  placeholder="https://api.example.com/v1"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-soft mb-1">
                  {t('globalProviders.form.model')}
                </label>
                <Input
                  value={form.model || ''}
                  onChange={e => set('model', e.target.value)}
                  placeholder="claude-sonnet-4-20250514"
                />
                <p className="mt-1 text-xs text-ink-mute">{t('globalProviders.form.modelHint')}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-soft mb-1">
                  {t('globalProviders.form.models')}
                </label>
                <ModelListEditor
                  models={form.models || []}
                  onChange={models => set('models', models)}
                  defaultModel={form.model}
                  onSetDefault={model => set('model', model)}
                />
                <p className="mt-1 text-xs text-ink-mute">{t('globalProviders.form.modelsHint')}</p>
              </div>
            </>
          ) : (
            <div className="rounded-card border border-hairline dark:border-white/10 overflow-hidden">
              <p className="px-3 pt-3 text-xs text-ink-mute">{t('globalProviders.form.perAgentHint')}</p>
              <div className="flex gap-1 px-3 pt-2 pb-0">
                {agents.map(at => (
                  <button
                    key={at}
                    type="button"
                    onClick={() => setActiveAgentTab(at)}
                    className={cn(
                      'px-3 py-1.5 rounded-t-lg text-xs font-medium transition-colors',
                      (activeAgentTab || agents[0]) === at
                        ? 'bg-surface text-ink ring-1 ring-hairline'
                        : 'text-ink-mute hover:text-ink-soft dark:hover:text-ink-mute',
                    )}
                  >
                    {at}
                  </button>
                ))}
              </div>
              <div className="px-3 pb-3 bg-surface">
                {agents.map(at => {
                  if ((activeAgentTab || agents[0]) !== at) return null;
                  return (
                    <AgentConfigEditor
                      key={at}
                      agentType={at}
                      config={perAgent[at] || { base_url: '', model: '', models: [] }}
                      onChange={cfg => updatePerAgent(at, cfg)}
                      t={t}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Thinking */}
          <div>
            <label className="block text-sm font-medium text-ink-soft mb-1">
              Thinking
            </label>
            <select
              value={form.thinking || ''}
              onChange={e => set('thinking', e.target.value)}
              className={cn(
                'w-full rounded-card border px-3 py-2 text-sm outline-none transition-colors',
                'bg-surface text-ink ring-1 ring-hairline hover:ring-hairline-strong',
                'focus:outline-none focus:ring-2 focus:ring-accent-text focus:ring-offset-2 focus:ring-offset-canvas',
              )}
            >
              <option value="">{t('globalProviders.form.thinkingDefault')}</option>
              <option value="enabled">enabled</option>
              <option value="disabled">disabled</option>
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={handleSubmit} disabled={!form.name || saving}>
            {saving ? t('common.loading') : t('common.save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ── CC-Switch Import Modal ── */

function CCSwitchImportModal({
  existingNames,
  onClose,
  onImported,
  t,
}: {
  existingNames: Set<string>;
  onClose: () => void;
  onImported: () => void;
  t: (key: string, opts?: any) => string;
}) {
  const [providers, setProviders] = useState<CCSwitchProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: string[]; skipped: string[] } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await listCCSwitchProviders();
        if (!data.available) {
          setError(data.error || t('globalProviders.ccSwitch.notFound'));
        } else {
          setProviders(data.providers || []);
          const selectable = (data.providers || []).filter(p => !existingNames.has(p.name));
          setSelected(new Set(selectable.map(p => p.name)));
        }
      } catch {
        setError(t('globalProviders.ccSwitch.notFound'));
      }
      setLoading(false);
    })();
  }, []);

  const toggle = (name: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const res = await importCCSwitchProviders([...selected]);
      setResult(res);
      onImported();
    } catch { /* empty */ }
    setImporting(false);
  };

  return (
    <Modal open onClose={onClose} title={t('globalProviders.ccSwitch.title')}>
      <div className="space-y-4">
        {loading && (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-2 border-accent border-t-transparent" />
          </div>
        )}

        {error && (
          <div className="rounded-card border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-900/10 p-4 text-sm text-amber-700 dark:text-amber-400">
            {error}
          </div>
        )}

        {!loading && !error && providers.length === 0 && (
          <p className="text-sm text-ink-soft text-center py-4">
            {t('globalProviders.ccSwitch.empty')}
          </p>
        )}

        {!loading && !error && providers.length > 0 && !result && (
          <>
            <p className="text-sm text-ink-soft">
              {t('globalProviders.ccSwitch.hint', { count: providers.length })}
            </p>
            <div className="max-h-72 overflow-y-auto space-y-1">
              {providers.map(p => {
                const exists = existingNames.has(p.name);
                return (
                  <label
                    key={p.name}
                    className={cn(
                      'flex items-center gap-3 rounded-card px-3 py-2.5 transition-colors cursor-pointer',
                      exists
                        ? 'opacity-50 cursor-not-allowed'
                        : selected.has(p.name)
                          ? 'bg-accent/10 dark:bg-accent/5'
                          : 'hover:bg-surface-sunken',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(p.name)}
                      disabled={exists}
                      onChange={() => !exists && toggle(p.name)}
                      className="rounded border-hairline-strong accent-text focus:ring-accent/30"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-ink truncate">
                          {p.name}
                        </span>
                        <Badge variant={p.app_type === 'claude' ? 'default' : 'info'}>
                          {p.app_type}
                        </Badge>
                        {p.is_current && <Badge variant="success">{t('globalProviders.ccSwitch.active')}</Badge>}
                        {exists && <Badge variant="warning">{t('globalProviders.ccSwitch.exists')}</Badge>}
                      </div>
                      <div className="text-xs text-ink-mute mt-0.5 truncate">
                        {p.model && <span>{p.model}</span>}
                        {p.model && p.base_url && <span> · </span>}
                        {p.base_url && <span>{p.base_url}</span>}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
              <Button onClick={handleImport} disabled={selected.size === 0 || importing}>
                {importing ? t('common.saving') : t('globalProviders.ccSwitch.import', { count: selected.size })}
              </Button>
            </div>
          </>
        )}

        {result && (
          <>
            <div className="rounded-card border border-green-200 dark:border-green-500/20 bg-green-50 dark:bg-green-900/10 p-4 text-sm text-green-700 dark:text-green-400">
              {t('globalProviders.ccSwitch.result', { imported: result.imported?.length || 0, skipped: result.skipped?.length || 0 })}
            </div>
            <div className="flex justify-end">
              <Button onClick={onClose}>{t('common.close')}</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
