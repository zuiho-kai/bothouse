import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Laptop,
  RotateCw,
  CheckCircle2,
  AlertCircle,
  Info,
  Radio,
  Layers,
} from 'lucide-react';
import { Card, Badge, Button, EmptyState, PageHeader, LoadingState } from '@/components/ui';
import { listDevices, type DeviceAdapter } from '@/api/devices';
import { listProjects, shownNames, type ProjectSummary } from '@/api/projects';

export default function DeviceList() {
  const { t } = useTranslation();
  const [devices, setDevices] = useState<DeviceAdapter[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const fetchDevices = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await listDevices();
      setDevices(res.devices || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load devices');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDevices();
    listProjects().then((r) => setProjects(r.projects || [])).catch(() => {});
  }, [fetchDevices]);

  const showName = shownNames(projects);

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        icon={Laptop}
        title={t('devices.title', '外接设备管理')}
        description={t('devices.subtitle', '管理桌面宠物、托盘客户端等通过本机接口接入的外接端')}
        actions={
          <Button variant="secondary" size="sm" onClick={fetchDevices} disabled={loading}>
            <RotateCw size={14} className={loading ? 'animate-spin' : ''} />
            {t('common.refresh', '刷新')}
          </Button>
        }
      />

      {/* 说明条统一走 accent-wash，不再用蓝色系：整套设置页只保留一个强调色（§0 one accent at a time） */}
      <div className="flex items-start gap-3 rounded-card bg-accent-wash p-4 text-xs leading-relaxed text-ink-soft ring-1 ring-accent/15">
        <Info size={16} strokeWidth={1.6} className="mt-0.5 shrink-0 text-accent-text" />
        <div>
          <span className="mb-0.5 block font-semibold text-ink">外接端本机接口已就绪</span>
          通过本机 Bridge Server 连接的外部适配器（如桌面宠物、状态托盘等客户端）将在此集中显示与统一管理。
        </div>
      </div>

      {msg && (
        <div className="flex items-center gap-2 rounded-card bg-emerald-500/10 p-3 text-sm text-emerald-700 ring-1 ring-emerald-500/25 dark:text-emerald-400">
          <CheckCircle2 size={16} className="shrink-0" />
          <span>{msg}</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-card bg-red-500/10 p-3 text-sm text-red-700 ring-1 ring-red-500/25 dark:text-red-400">
          <AlertCircle size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && devices.length === 0 ? (
        <LoadingState label={t('common.loading')} />
      ) : devices.length === 0 ? (
        <Card>
          <EmptyState
            icon={Laptop}
            message={t('devices.noDevices', '暂无已连接的外接适配器，支持桌宠、托盘客户端等通过本机接口自动接入')}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {devices.map((dev, idx) => (
            <Card key={`${dev.platform}-${idx}`} hover className="flex flex-col justify-between">
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-surface-sunken text-ink-mute ring-1 ring-hairline">
                      <Radio size={19} strokeWidth={1.6} />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-ink">{dev.platform}</div>
                      <span className="mt-0.5 block truncate text-xs text-ink-mute">
                        {dev.project ? `绑定角色: ${showName(dev.project)}` : '全局适配器'}
                      </span>
                    </div>
                  </div>

                  <Badge variant="success">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    已连接
                  </Badge>
                </div>

                <div className="space-y-2 rounded-control bg-surface-sunken p-3 text-xs ring-1 ring-hairline">
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex shrink-0 items-center gap-1.5 text-ink-soft">
                      <Layers size={13} strokeWidth={1.6} className="text-ink-mute" />
                      支持能力：
                    </span>
                    <div className="flex flex-wrap justify-end gap-1">
                      {dev.capabilities && dev.capabilities.length > 0 ? (
                        dev.capabilities.map((cap) => (
                          <span
                            key={cap}
                            className="rounded bg-surface px-1.5 py-0.5 font-mono text-[10px] text-ink-soft ring-1 ring-hairline"
                          >
                            {cap}
                          </span>
                        ))
                      ) : (
                        <span className="text-ink-mute">标准通信</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
