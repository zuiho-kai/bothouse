import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Laptop,
  RotateCw,
  Power,
  Activity,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  Info,
} from 'lucide-react';
import { Card, Badge, Button, EmptyState } from '@/components/ui';
import { listDevices, updateDevice, type Device } from '@/api/devices';

export default function DeviceList() {
  const { t } = useTranslation();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
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

  const handleToggleEnabled = async (dev: Device) => {
    try {
      setActionLoading((prev) => ({ ...prev, [dev.id]: true }));
      setMsg('');
      const res = await updateDevice(dev.id, { enabled: !dev.enabled });
      setMsg(`设备 ${res.device.name} 开关已切换为 ${res.device.enabled ? '启用' : '禁用'}`);
      await fetchDevices();
    } catch (e: any) {
      setError(e.message || 'Update failed');
    } finally {
      setActionLoading((prev) => ({ ...prev, [dev.id]: false }));
    }
  };

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
          桌宠、系统托盘及移动外接端可通过本机 9820 管理接口 <code className="bg-blue-100/70 dark:bg-blue-900/40 px-1 py-0.5 rounded font-mono">/api/v1/devices/register</code> 进行注册并使用心跳报活，统一接入控制台。
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
            message={t('devices.noDevices', '暂无已注册的外接端，支持桌宠、托盘客户端等通过本机接口自动接入')}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {devices.map((dev) => {
            const isUpdating = !!actionLoading[dev.id];
            const isOnline = dev.status === 'online';

            return (
              <Card key={dev.id} className="flex flex-col justify-between p-5 hover:border-accent/40 transition-all">
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-xl bg-accent/10 dark:bg-accent/20 text-accent flex items-center justify-center font-bold text-base">
                        <Laptop size={20} />
                      </div>
                      <div>
                        <div className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                          <span>{dev.name}</span>
                        </div>
                        <span className="text-xs text-gray-400 font-mono mt-0.5">
                          {dev.id}
                        </span>
                      </div>
                    </div>

                    <Badge variant={isOnline ? 'success' : 'default'} className="gap-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                      {isOnline ? '在线' : '离线'}
                    </Badge>
                  </div>

                  <div className="space-y-2 text-xs bg-gray-50/70 dark:bg-white/[0.02] p-3 rounded-lg border border-gray-100 dark:border-white/[0.04]">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500 dark:text-gray-400">设备类型：</span>
                      <span className="font-medium text-gray-700 dark:text-gray-300 capitalize">{dev.type}</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-gray-500 dark:text-gray-400">客户端版本：</span>
                      <span className="font-mono text-gray-700 dark:text-gray-300">{dev.version || 'v1.0.0'}</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-gray-500 dark:text-gray-400">最后活跃：</span>
                      <span className="text-gray-600 dark:text-gray-400 flex items-center gap-1">
                        <Clock size={11} />
                        {new Date(dev.last_seen).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-gray-100 dark:border-white/[0.06] mt-4">
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    运行开关：
                    <span className={`font-semibold ml-1 ${dev.enabled ? 'text-emerald-500' : 'text-gray-400'}`}>
                      {dev.enabled ? '已启用' : '已停用'}
                    </span>
                  </span>

                  <Button
                    variant={dev.enabled ? 'secondary' : 'primary'}
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={() => handleToggleEnabled(dev)}
                    disabled={isUpdating}
                  >
                    <Power size={13} />
                    {dev.enabled ? '停用' : '启用'}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
