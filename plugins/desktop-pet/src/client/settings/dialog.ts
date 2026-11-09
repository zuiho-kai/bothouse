/**
 * 确认 / 提示弹窗（仿官方视觉：遮罩 + 居中卡片 + 按钮）。
 * 五种场景各有自己的按钮组合：删除要确认、只剩一只（main / 某个种类）只能「知道了」、
 * 同步要确认、配置损坏要确认强行重建。
 * 确认后的动作由设置页外壳执行（它才知道怎么删、怎么带 force 存盘），这里只负责问与答。
 * @module dsh-pet/src/client/settings/dialog
 */
import type { FunctionComponent } from 'react';
import type * as ReactNS from 'react';
import type { SettingsRuntime } from './runtime.ts';

/** 弹窗场景；`corrupt` 带出宿主给的真实写入路径，`lastOfKind` 带出删不掉的种类名。 */
export type DialogState =
  | null
  | { kind: 'remove' }
  | { kind: 'lastOne' }
  | { kind: 'lastOfKind'; entry: string }
  | { kind: 'sync' }
  | { kind: 'corrupt'; path: string };

/** 弹窗的输入。 */
export interface DialogProps {
  /** 当前场景；`null` 表示不显示。 */
  dialog: Exclude<DialogState, null>;
  /** 当前选中的宠物 id，用于「删除宠物 X」的确认文案。 */
  selId: string;
  /** 取消：点遮罩、取消按钮或「知道了」。 */
  onDismiss: () => void;
  /** 确认：由外壳按场景派发到删除 / 强行重建 / 同步。 */
  onConfirm: () => void;
}

/** 正文文案：每个场景一句，参数就地代入。 */
function bodyText(dialog: Exclude<DialogState, null>, t: (key: string) => string, selId: string): string {
  if (dialog.kind === 'remove') return t('confirmRemove').replace('{id}', selId);
  if (dialog.kind === 'lastOne') return t('atLeastOne');
  if (dialog.kind === 'lastOfKind') return t('lastOfKind').replace('{entry}', dialog.entry);
  if (dialog.kind === 'corrupt') return t('corruptBody').replace('{path}', dialog.path);
  return t('confirmSync');
}

/** 确认按钮文案：三个可确认场景各一句。 */
function confirmLabel(kind: 'remove' | 'sync' | 'corrupt', t: (key: string) => string): string {
  if (kind === 'remove') return t('remove');
  if (kind === 'corrupt') return t('corruptConfirm');
  return t('sync');
}

/**
 * 造确认弹窗。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 弹窗组件。
 */
export function makeDialog(rt: SettingsRuntime): FunctionComponent<DialogProps> {
  const { h, t } = rt;

  return function SettingsDialog(props: DialogProps) {
    const { dialog } = props;
    // 只剩一只（main 或某个种类）没有可确认的动作：直接收窄成 null，下面的分支就不用再看 kind。
    const confirmable = dialog.kind === 'lastOne' || dialog.kind === 'lastOfKind' ? null : dialog;
    return h('div', {
      style: {
        position: 'fixed',
        inset: 0,
        zIndex: 2147483647,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.45)',
      },
      onClick: props.onDismiss,
      children: h('div', {
        style: {
          width: '340px',
          maxWidth: 'calc(100vw - 40px)',
          background: 'var(--dsw-alias-bg-layer-1)',
          border: '1px solid var(--dsw-alias-border-l2)',
          borderRadius: '12px',
          padding: '16px 18px',
          boxShadow: '0 8px 30px rgba(0, 0, 0, 0.35)',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        },
        onClick: (e: ReactNS.MouseEvent<HTMLDivElement>) => e.stopPropagation(),
        children: [
          h('div', {
            style: { fontSize: '14px', fontWeight: 500, color: 'var(--dsw-alias-label-primary)' },
            children: t(dialog.kind === 'corrupt' ? 'corruptTitle' : 'confirmTitle'),
          }),
          h('div', {
            style: { fontSize: '13px', lineHeight: '20px', color: 'var(--dsw-alias-label-secondary)' },
            children: bodyText(dialog, t, props.selId),
          }),
          h('div', {
            style: { display: 'flex', gap: '8px', justifyContent: 'flex-end' },
            // 只剩一只没有可确认的动作，只给「知道了」；其余都是取消 + 确认双按钮。
            children:
              confirmable === null
                ? [
                    h('button', {
                      key: 'ok',
                      type: 'button',
                      onClick: props.onDismiss,
                      className: 'dsh-pet-cfg__btn is-primary',
                      children: t('ok'),
                    }),
                  ]
                : [
                    h('button', {
                      key: 'cancel',
                      type: 'button',
                      onClick: props.onDismiss,
                      className: 'dsh-pet-cfg__btn',
                      children: t('cancel'),
                    }),
                    h('button', {
                      key: 'confirm',
                      type: 'button',
                      onClick: props.onConfirm,
                      className: 'dsh-pet-cfg__btn ' + (confirmable.kind === 'sync' ? 'is-primary' : 'is-danger'),
                      children: confirmLabel(confirmable.kind, t),
                    }),
                  ],
          }),
        ],
      }),
    });
  };
}
