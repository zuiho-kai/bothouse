import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Button, Input } from '@/components/ui';
import { getProviderModels, type ProviderModel, type ProviderModelsError, type ProviderModelsRequest } from '@/api/wizard';
import { wizardTexts } from './texts';

export interface ProviderModelInputProps {
  provider: ProviderModelsRequest;
  /** Role identity and selected CLI. Credentials must not be included here. */
  scopeKey: string;
  value: string;
  onChange: (model: string) => void;
  placeholder?: string;
  testId?: string;
  texts: ReturnType<typeof wizardTexts>;
}

type ModelState =
  | { status: 'idle' | 'loading' }
  | { status: 'loaded'; models: ProviderModel[] }
  | { status: 'error'; code: ProviderModelsError | 'request_failed' };

export default function ProviderModelInput({ provider, scopeKey, value, onChange, placeholder, testId, texts: T }: ProviderModelInputProps) {
  const inputId = useId();
  const [state, setState] = useState<ModelState>({ status: 'idle' });
  const [search, setSearch] = useState('');
  const requestVersion = useRef(0);
  const { vendor, base_url, api_key } = provider;

  // Clear old choices before paint, and invalidate pending work even if the user
  // changes credentials back to their previous value before a request finishes.
  useLayoutEffect(() => {
    requestVersion.current += 1;
    setState({ status: 'idle' });
    setSearch('');
    return () => { requestVersion.current += 1; };
  }, [vendor, base_url, api_key, scopeKey]);

  const fetchModels = async () => {
    const version = ++requestVersion.current;
    setState({ status: 'loading' });
    setSearch('');
    try {
      const result = await getProviderModels({ vendor, base_url, api_key });
      if (version !== requestVersion.current) return;
      setState(result.error_code
        ? { status: 'error', code: result.error_code }
        : { status: 'loaded', models: result.models });
    } catch {
      // Upstream errors can contain credentials. Render only our own copy.
      if (version === requestVersion.current) setState({ status: 'error', code: 'request_failed' });
    }
  };

  const query = search.trim().toLowerCase();
  const models = state.status === 'loaded'
    ? state.models.filter((model) => `${model.id} ${model.name || ''}`.toLowerCase().includes(query))
    : [];
  const errors: Record<ProviderModelsError | 'request_failed', string> = {
    bad_url: T.modelsBadURL,
    unauthorized: T.modelsUnauthorized,
    not_found: T.modelsNotFound,
    unreachable: T.modelsUnreachable,
    invalid_response: T.modelsInvalidResponse,
    upstream_error: T.modelsUpstreamError,
    request_failed: T.modelsRequestFailed,
  };

  return (
    <div className="min-w-0 space-y-1.5" aria-busy={state.status === 'loading'}>
      <div className="flex flex-wrap items-center justify-between gap-1">
        <label htmlFor={inputId} className="text-sm font-medium text-gray-700 dark:text-gray-300">{T.model}</label>
        <Button type="button" size="sm" variant="secondary" className="shrink-0" loading={state.status === 'loading'}
          disabled={!vendor} onClick={fetchModels}>
          {state.status === 'loading' ? T.modelsLoading : T.modelsFetch}
        </Button>
      </div>
      <Input id={inputId} value={value} placeholder={placeholder} data-testid={testId}
        onChange={(event) => onChange(event.target.value.trim())} />
      {state.status === 'error' && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{errors[state.code]}</p>}
      {state.status === 'loaded' && (
        state.models.length === 0
          ? <p role="status" className="text-xs text-gray-500">{T.modelsEmpty}</p>
          : <div className="space-y-2 rounded-lg border border-gray-200 p-2 dark:border-gray-700">
            <Input type="search" aria-label={T.modelsSearch} placeholder={T.modelsSearch} value={search}
              onChange={(event) => setSearch(event.target.value)} />
            <div role="group" aria-label={T.modelsChoices} className="max-h-44 space-y-1 overflow-y-auto">
              {models.map((model) => (
                <button key={model.id} type="button" title={model.id} aria-pressed={model.id === value}
                  className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-gray-800 hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:text-gray-200 aria-pressed:bg-accent/10"
                  onClick={() => onChange(model.id)}>
                  <span className="block break-all">{model.name || model.id}</span>
                  {model.name && model.name !== model.id && <span className="block break-all text-[11px] text-gray-500">{model.id}</span>}
                </button>
              ))}
              {models.length === 0 && <p role="status" className="text-xs text-gray-500">{T.modelsNoMatches}</p>}
            </div>
          </div>
      )}
    </div>
  );
}
