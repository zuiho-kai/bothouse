/**
 * 设置页的写路径编排：保存、请求同步、以及确认弹窗里那一下「确认」到底做什么。
 * 三个动作都要先过一遍表单校验（同一套规则），再把结果翻译成红字或弹窗——调用方只接状态。
 * 传进来的是回调而不是值：`save` 每次渲染重建，直接捕获状态会拿旧值存盘。
 * @module dsh-pet/src/client/settings/config/write-flow
 */
import type { SaveFields } from './http.ts';
import type { MergedConfig } from './read.ts';
import type { Feedback } from '../actions.ts';
import type { DialogState } from '../dialog.ts';
import { persistSettings, syncSettings } from './persist.ts';
import type { PackWrite } from './pack-writes.ts';
import { validateForm } from './validate-form.ts';

/** {@link createWriteFlow} 的依赖。 */
export interface WriteFlowDeps {
  /** 现取要提交的全部字段。 */
  fields: () => SaveFields;
  /** 现算有改动的种类层（与加载快照比较，main 不在其中）。 */
  packWrites: () => readonly PackWrite[];
  /** 当前是否正在保存（重入保护）。 */
  busy: () => boolean;
  /** 置保存中标志；写盘期间表单整体禁用。 */
  setBusy: (busy: boolean) => void;
  /** 就地显示保存 / 同步反馈。 */
  setMsg: (feedback: Feedback) => void;
  /** 打开或关闭弹窗。 */
  setDialog: (dialog: DialogState) => void;
  /** 读当前弹窗，确认时才知道该派发哪个动作。 */
  dialog: () => DialogState;
  /** 同步成功后刷新表单。 */
  applyConfig: (merged: MergedConfig) => void;
  /** 宿主没回真实写入路径时的兜底（meta 里的用户配置路径）。 */
  userFile: () => string;
  /** 文案翻译。 */
  t: (key: string) => string;
  /** 真的删掉选中的宠物（校验与确认都过了才会调）。 */
  onRemove: () => void;
}

/** 写路径暴露的三个入口。 */
export interface WriteFlow {
  /** 保存全部配置；`force` 严格为 `true` 才允许重建损坏文件。 */
  save: (force?: boolean) => Promise<void>;
  /** 请求同步：先弹确认（会覆盖用户层，不能点一下就干）。 */
  requestSync: () => void;
  /** 弹窗确认后的派发。 */
  confirmDialog: () => void;
}

/**
 * 造写路径。
 *
 * @param deps - 状态读取与写入回调。
 * @returns 保存 / 请求同步 / 确认派发。
 */
export function createWriteFlow(deps: WriteFlowDeps): WriteFlow {
  const { setBusy, setMsg, setDialog, t } = deps;

  const save = async (force = false): Promise<void> => {
    if (deps.busy()) return;
    const fields = deps.fields();
    const invalid = validateForm({
      pets: fields.pets,
      physics: fields.physics,
      whisperModel: fields.whisperModel,
      chatModel: fields.chatModel,
      chatMemory: fields.chatMemoryRounds,
      chatImageLimit: fields.chatImageLimit,
      font: fields.font,
    });
    if (invalid !== null) {
      setMsg({ kind: 'err', text: t(invalid) });
      return;
    }
    setBusy(true);
    setMsg({ kind: '', text: '' });
    try {
      const result = await persistSettings(fields, deps.packWrites(), force, deps.userFile());
      if (result.kind === 'ok') {
        setMsg({ kind: 'ok', text: t('saved') });
        return;
      }
      if (result.kind === 'corrupt') {
        setDialog({ kind: 'corrupt', path: result.path });
        return;
      }
      // main 已落盘、部分种类没写成功：必须如实说，否则用户会以为整包都没保存。
      if (result.kind === 'partial') {
        setMsg({ kind: 'err', text: t('savePartial').replace('{names}', result.failed.join('、')) });
        return;
      }
      setMsg({ kind: 'err', text: t(result.kind === 'invalid' ? 'saveInvalid' : 'saveError') });
    } finally {
      setBusy(false);
    }
  };

  const doSync = async (): Promise<void> => {
    setBusy(true);
    setMsg({ kind: '', text: '' });
    try {
      // 同步用户层：POST 把内置默认配置（原文，含注释）整份写入用户配置，响应体同样是成品聚合。
      const merged = await syncSettings();
      if (merged === null) {
        setMsg({ kind: 'err', text: t('syncError') });
        return;
      }
      // 同一份成品既刷新表单也交给容器：编辑列表与渲染列表都由成品派生。
      deps.applyConfig(merged);
      setMsg({ kind: 'ok', text: t('saved') });
    } finally {
      setBusy(false);
    }
  };

  return {
    save,
    requestSync: () => setDialog({ kind: 'sync' }),
    confirmDialog: () => {
      const pending = deps.dialog();
      if (pending === null) return;
      setDialog(null);
      if (pending.kind === 'remove') deps.onRemove();
      else if (pending.kind === 'corrupt') void save(true);
      else if (pending.kind === 'sync') void doSync();
    },
  };
}
