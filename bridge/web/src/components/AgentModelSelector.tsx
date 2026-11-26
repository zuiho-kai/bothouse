import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, RefreshCw } from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import { getProjectModels } from '@/api/projects';
import { getSetupModels, type ModelOptionItem } from '@/api/wizard';
import { isZhLang } from '@/pages/Setup/texts';

interface AgentModelSelectorProps {
  /** Existing project name: fetches GET /projects/{name}/models when matching its live agent type. */
  projectName?: string;
  /** Whether projectName's live agent matches agentType; false falls back to GET /setup/models. */
  useProjectEndpoint?: boolean;
  agentType: string;
  remoteHost?: string;
  relayHost?: string;
  sshArgs?: string[];
  value: string;
  onChange: (model: string) => void;
  testIdPrefix?: string;
}

const normalizeModelOptions = (raw?: {
  models?: string[];
  options?: Array<{ name?: string; desc?: string; Name?: string; Desc?: string }>;
}): ModelOptionItem[] => {
  if (raw?.options && raw.options.length > 0) {
    const out: ModelOptionItem[] = [];
    for (const o of raw.options) {
      const name = (o.name ?? o.Name ?? '').trim();
      if (!name) continue;
      const desc = (o.desc ?? o.Desc ?? '').trim();
      out.push({ name, ...(desc ? { desc } : {}) });
    }
    if (out.length > 0) return out;
  }
  return (raw?.models || []).filter(Boolean).map((name) => ({ name }));
};

/**
 * Fetches live available models from backend (`ducc models` / `zulu list-model` local or remote SSH)
 * and lets the user filter and assign a specific model per bot.
 */
export default function AgentModelSelector({
  projectName,
  useProjectEndpoint = false,
  agentType,
  remoteHost = '',
  relayHost = '',
  sshArgs,
  value,
  onChange,
  testIdPrefix = 'agent-model',
}: AgentModelSelectorProps) {
  const { i18n } = useTranslation();
  const zh = isZhLang(i18n.language || 'en');
  const [options, setOptions] = useState<ModelOptionItem[]>([]);
  const [source, setSource] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  const sshKey = (sshArgs || []).join(' ');

  const fetchModels = useCallback(
    async (refresh = false) => {
      if (!agentType) return;
      setLoading(true);
      setError('');
      try {
        if (projectName && useProjectEndpoint) {
          const res = await getProjectModels(projectName, refresh);
          setOptions(normalizeModelOptions(res));
          setSource(agentType === 'zulu' ? (remoteHost.trim() ? 'zulu-remote' : 'zulu') : agentType);
        } else {
          const res = await getSetupModels({
            agent_type: agentType,
            remote_host: remoteHost.trim() || undefined,
            relay_host: relayHost.trim() || undefined,
            ssh_args: sshArgs,
            refresh,
          });
          setOptions(normalizeModelOptions(res));
          setSource(res.source || '');
        }
      } catch (e: any) {
        setError(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectName, useProjectEndpoint, agentType, remoteHost, relayHost, sshKey],
  );

  useEffect(() => {
    const delay = remoteHost.trim() ? 450 : 0;
    const timer = window.setTimeout(() => {
      void fetchModels(false);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [fetchModels, remoteHost]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        (o.desc && o.desc.toLowerCase().includes(q)),
    );
  }, [options, query]);

  const hasSelectedInFiltered = !value || filtered.some((o) => o.name === value);

  return (
    <div className="space-y-1.5" data-testid={`${testIdPrefix}-box`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-400">
          <span>{zh ? '默认模型（Model）' : 'Default model'}</span>
          {options.length > 0 && (
            <Badge variant="outline" className="font-normal">
              {source ? `${source} · ` : ''}
              {options.length}
            </Badge>
          )}
        </label>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={loading}
          data-testid={`${testIdPrefix}-refresh`}
          onClick={() => void fetchModels(true)}
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          {zh ? '刷新模型' : 'Refresh'}
        </Button>
      </div>

      {options.length > 10 && (
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-testid={`${testIdPrefix}-filter`}
          placeholder={zh ? '搜索筛选模型（如 sonnet / gpt-6 / gemini / glm）…' : 'Filter models (e.g. sonnet / gpt-6 / gemini)…'}
          className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-xs text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-accent/50"
        />
      )}

      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={`${testIdPrefix}-select`}
        className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent/50"
      >
        <option value="">{zh ? '跟随 CLI 默认（auto）' : 'CLI default (auto)'}</option>
        {!hasSelectedInFiltered && value && (
          <option value={value}>{value}</option>
        )}
        {filtered.map((opt) => (
          <option key={opt.name} value={opt.name}>
            {opt.desc && opt.desc !== opt.name ? `${opt.name} (${opt.desc})` : opt.name}
          </option>
        ))}
      </select>

      {error && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400" data-testid={`${testIdPrefix}-error`}>
          {zh ? `拉取模型列表失败（可重试）：${error}` : `Failed to fetch models: ${error}`}
        </p>
      )}
    </div>
  );
}
