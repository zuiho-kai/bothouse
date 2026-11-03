import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Plus, Settings2, Smartphone } from 'lucide-react';
import { Button, Input, Modal } from '@/components/ui';
import { platformMeta } from '@/lib/platformMeta';
import PlatformSetupQR from './PlatformSetupQR';
import PlatformManualForm from './PlatformManualForm';

const AGENT_OPTIONS = [
  { key: 'claudecode', label: 'Claude Code' },
  { key: 'codex', label: 'Codex' },
  { key: 'gemini', label: 'Gemini CLI' },
  { key: 'antigravity', label: 'Antigravity CLI' },
  { key: 'cursor', label: 'Cursor' },
  { key: 'devin', label: 'Devin' },
  { key: 'copilot', label: 'Copilot (GitHub)' },
  { key: 'acp', label: 'ACP (Generic)' },
  { key: 'acp:openclaw', label: 'OpenClaw (ACP)' },
  { key: 'opencode', label: 'OpenCode' },
  { key: 'qoder', label: 'Qoder' },
];

const PLATFORM_OPTIONS: { key: string; label: string; color: string; qr?: boolean }[] = [
  { key: 'feishu', label: 'Feishu / Lark', color: 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400', qr: true },
  { key: 'weixin', label: 'WeChat', color: 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400', qr: true },
  { key: 'telegram', label: 'Telegram', color: 'bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400' },
  { key: 'discord', label: 'Discord', color: 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400' },
  { key: 'slack', label: 'Slack', color: 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400' },
  { key: 'dingtalk', label: 'DingTalk', color: 'bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400' },
  { key: 'wecom', label: 'WeChat Work', color: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' },
  { key: 'qq', label: 'QQ (OneBot)', color: 'bg-cyan-50 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400' },
  { key: 'qqbot', label: 'QQ Bot (Official)', color: 'bg-cyan-50 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400' },
  { key: 'yuanbao', label: 'Yuanbao', color: 'bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400' },
  { key: 'line', label: 'LINE', color: 'bg-lime-50 dark:bg-lime-900/30 text-lime-600 dark:text-lime-400' },
  { key: 'weibo', label: 'Weibo (微博)', color: 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400' },
  { key: 'tuitui', label: 'TuiTui (推推)', color: 'bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300' },
  { key: 'cloud_web', label: 'Cloud Web (自建 IM)', color: 'bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400' },
];

type WizardStep = 'name' | 'platform' | 'qr' | 'form' | 'done';

interface WizardProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const isQRPlatform = (type: string) => type === 'feishu' || type === 'lark' || type === 'weixin';

/** 新建项目向导：与列表页逻辑一致，从 ProjectList 抽出来单独一层，列表页只负责开与关。 */
export function ProjectWizard({ open, onClose, onCreated }: WizardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [step, setStep] = useState<WizardStep>('name');
  const [name, setName] = useState('');
  const [workDir, setWorkDir] = useState('');
  const [agentType, setAgentType] = useState('claudecode');
  const [platform, setPlatform] = useState('');

  const reset = () => {
    setStep('name');
    setName('');
    setWorkDir('');
    setAgentType('claudecode');
    setPlatform('');
  };

  const close = () => {
    reset();
    onClose();
  };

  const pickPlatform = (key: string) => {
    setPlatform(key);
    if (isQRPlatform(key)) setStep('qr');
    else if (platformMeta[key]) setStep('form');
    else setStep('done');
  };

  return (
    <Modal open={open} onClose={close} title={t('setup.addProject', '新建项目')}>
      {step === 'name' && (
        <div className="space-y-4 py-2">
          <Input
            label={t('setup.projectName', '项目名')}
            value={name}
            onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
            placeholder="my-project"
            autoFocus
          />
          <Input
            label={t('setup.workDir', '工作目录')}
            value={workDir}
            onChange={(e) => setWorkDir(e.target.value)}
            placeholder="/path/to/project"
          />
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-soft">
              {t('setup.agentType', 'Agent 类型')}
            </label>
            <select
              value={agentType}
              onChange={(e) => setAgentType(e.target.value)}
              className="h-10 w-full rounded-control bg-surface px-3 text-sm text-ink ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-accent-text"
            >
              {AGENT_OPTIONS.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button disabled={!name.trim() || !workDir.trim()} onClick={() => setStep('platform')}>
              {t('setup.next', '下一步')}
            </Button>
          </div>
        </div>
      )}

      {step === 'platform' && (
        <div className="space-y-3 py-2">
          <p className="mb-2 text-sm text-ink-soft">
            {t('setup.choosePlatform', '选择要接入的平台：')}
          </p>
          <div className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto">
            {PLATFORM_OPTIONS.map(({ key, label, color, qr }) => (
              <button
                key={key}
                onClick={() => pickPlatform(key)}
                className="flex items-center gap-2.5 rounded-card p-2.5 text-left ring-1 ring-hairline transition-all duration-base ease-ui-out hover:bg-accent-wash hover:ring-accent-text/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-text"
              >
                <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-control ${color}`}>
                  {qr ? <Smartphone size={16} /> : <Settings2 size={16} />}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink">{label}</div>
                  <div className="truncate text-[11px] text-ink-mute">
                    {qr ? t('setup.scanToConnect', '扫码接入') : t('setup.manualSetup', '手动填写')}
                  </div>
                </div>
              </button>
            ))}
          </div>
          <div className="flex justify-start pt-2">
            <Button variant="secondary" size="sm" onClick={() => setStep('name')}>
              {t('common.back')}
            </Button>
          </div>
        </div>
      )}

      {step === 'qr' && isQRPlatform(platform) && (
        <PlatformSetupQR
          platformType={platform as 'feishu' | 'weixin'}
          projectName={name}
          workDir={workDir}
          agentType={agentType}
          onComplete={() => {
            reset();
            onCreated();
          }}
          onCancel={() => setStep('platform')}
        />
      )}

      {step === 'form' && platformMeta[platform] && (
        <PlatformManualForm
          platformType={platform}
          projectName={name}
          workDir={workDir}
          agentType={agentType}
          onComplete={() => {
            reset();
            onCreated();
          }}
          onCancel={() => setStep('platform')}
        />
      )}

      {step === 'done' && !isQRPlatform(platform) && (
        <div className="space-y-4 py-4 text-center">
          <Plus size={36} className="mx-auto text-ink-mute" />
          <p className="text-sm text-ink-soft">
            {t(
              'setup.manualHint',
              '平台 {{platform}} 的凭据稍后在项目页填写；项目本身先建好。',
              { platform: PLATFORM_OPTIONS.find((o) => o.key === platform)?.label || platform }
            )}
          </p>
          <div className="flex justify-center gap-2">
            <Button variant="secondary" onClick={() => setStep('platform')}>
              {t('common.back')}
            </Button>
            <Button
              onClick={() => {
                const target = name;
                reset();
                onCreated();
                navigate(`/projects/${target}`);
              }}
            >
              {t('projects.openDetail', '打开项目页')}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
