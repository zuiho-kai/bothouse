import api from './client';

export interface UsageRow {
  date?: string; hour: number; role?: string; model?: string;
  input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number;
  total_tokens: number; responses: number; replies?: number; unknown_usage_responses: number;
  estimated_cost?: number; unpriced_responses: number;
}
export interface UsageResult { from: string; to: string; timezone: string; items: UsageRow[] }
export const getUsage = (group: 'daily' | 'hourly' | 'roles' | 'models', params: Record<string, string> = {}) =>
  api.get<UsageResult>(`/usage/${group}`, params);
