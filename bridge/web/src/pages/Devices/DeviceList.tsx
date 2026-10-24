import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Laptop,
  RotateCw,
  Activity,
  CheckCircle2,
  AlertCircle,
  Info,
  Radio,
  Layers,
} from 'lucide-react';
import { Card, Badge, Button, EmptyState } from '@/components/ui';
import { listDevices, type DeviceAdapter } from '@/api/devices';

export default function DeviceList() {
  const { t } = useTranslation();
  const [devices, setDevices] = useState<DeviceAdapter[]>([]);
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
  }, [fetchDevices]);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Laptop size={22} className="text-accent" />
            {t('devices.title', '外接设备管理')}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t('devices.subtitle', '管理桌面宠物、托盘客户端等通过本机接口接入的外接端')}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={fetchDevices} disabled={loading} className="gap-2 self-start">
          <RotateCw size={14} className={loading ? 'animate-spin' : ''} />
          {t('common.refresh', '刷新')}
        </Button>
      </div>

      {/* Info notice about external clients */}
      <div className="p-4 rounded-xl bg-blue-50/70 dark:bg-blue-950/20 text-blue-700 dark:text-blue-300 border border-blue-200/60 dark:border-blue-900/50 flex items-start gap-3 text-xs leading-relaxed">
        <Info size={16} className="shrink-0 mt-0.5 text-blue-500" />
        <div>
          <span className="font-semibold block mb-0.5">外接端本机接口已就绪</span>
          通过本机 Bridge Server 连接的外部适配器（如桌面宠物、状态托盘等客户端）将在此集中显示与统一管理。
        </div>
      </div>

      {msg && (
        <div className="p-3 text-sm rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 flex items-center gap-2">
          <CheckCircle2 size={16} />
          <span>{msg}</span>
        </div>
      )}

      {error && (
        <div className="p-3 text-sm rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800 flex items-center gap-2">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {loading && devices.length === 0 ? (
        <div className="flex items-center justify-center h-64 text-gray-400">
          <Activity className="animate-pulse" size={24} />
        </div>
      ) : devices.length === 0 ? (
        <div className="rounded-xl border border-gray-200/80 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-8">
          <EmptyState
            icon={Laptop}
            message={t('devices.noDevices', '暂无已连接的外接适配器，支持桌宠、托盘客户端等通过本机接口自动接入')}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {devices.map((dev, idx) => (
            <Card key={`${dev.platform}-${idx}`} className="flex flex-col justify-between p-5 hover:border-accent/40 transition-all">
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-xl bg-accent/10 dark:bg-accent/20 text-accent flex items-center justify-center font-bold text-base">
                      <Radio size={20} />
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                        <span>{dev.platform}</span>
                      </div>
                      <span className="text-xs text-gray-400 mt-0.5">
                        {dev.project ? `绑定角色: ${dev.project}` : '全局适配器'}
                      </span>
                    </div>
                  </div>

                  <Badge variant="success" className="gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    已连接
                  </Badge>
                </div>

                <div className="space-y-2 text-xs bg-gray-50/70 dark:bg-white/[0.02] p-3 rounded-lg border border-gray-100 dark:border-white/[0.04]">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-gray-500 dark:text-gray-400 flex items-center gap-1.5 shrink-0">
                      <Layers size={13} className="text-gray-400" />
                      支持能力：
                    </span>
                    <div className="flex flex-wrap gap-1 justify-end">
                      {dev.capabilities && dev.capabilities.length > 0 ? (
                        dev.capabilities.map((cap) => (
                          <span
                            key={cap}
                            className="px-1.5 py-0.5 rounded bg-gray-200/50 dark:bg-white/[0.06] text-[10px] text-gray-700 dark:text-gray-300 font-mono"
                          >
                            {cap}
                          </span>
                        ))
                      ) : (
                        <span className="text-gray-400">标准通信</span>
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
