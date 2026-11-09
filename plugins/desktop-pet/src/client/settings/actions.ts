/**
 * 操作区：保存、同步、测试通知三个按钮，以及两处反馈（保存 / 同步结果与测试通知结果分开）。
 * 「同步」会把内置默认整份覆盖用户层，副作用说明收进问号；反馈只在有内容时出现，不占位。
 * @module dsh-pet/src/client/settings/actions
 */
import type { FunctionComponent } from 'react';
import type { SettingsRuntime } from './runtime.ts';
import { makeUiKit } from './ui.ts';

/** 一处反馈：文案与是否错误。 */
export interface Feedback {
  kind: 'ok' | 'err' | '';
  text: string;
}

/** 操作区的输入。 */
export interface ActionsProps {
  /** 保存中或配置未就绪时禁用保存与同步。 */
  busy: boolean;
  /** 保存 / 同步的结果。 */
  msg: Feedback;
  /** 测试通知的结果。 */
  permMsg: Feedback;
  /** 保存全部配置。 */
  onSave: () => void;
  /** 请求同步（会先弹确认）。 */
  onSync: () => void;
  /** 发一条测试系统通知。 */
  onTestNotification: () => void;
}

/**
 * 造操作区。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 操作区组件。
 */
export function makeActions(rt: SettingsRuntime): FunctionComponent<ActionsProps> {
  const { h, t } = rt;
  const { tip, q } = makeUiKit({ h, t });

  return function Actions(props: ActionsProps) {
    const { busy, msg, permMsg } = props;
    return h('div', {
      className: 'dsh-pet-cfg__actions',
      children: [
        h('button', {
          type: 'button',
          disabled: busy,
          onClick: props.onSave,
          className: 'dsh-pet-cfg__btn is-primary',
          // 悬浮按钮即出快捷键气泡。
          ...tip(t('saveHotkey')),
          children: t('save'),
        }),
        h('button', {
          type: 'button',
          disabled: busy,
          onClick: props.onSync,
          className: 'dsh-pet-cfg__btn',
          children: t('sync'),
        }),
        h('button', {
          type: 'button',
          onClick: props.onTestNotification,
          className: 'dsh-pet-cfg__btn',
          children: t('notifyTest'),
        }),
        q(t('syncHint')),
        // 两个反馈各归各的：msg 是保存 / 同步结果，permMsg 是测试通知结果。
        msg.text
          ? h('span', {
              className: 'dsh-pet-cfg__msg' + (msg.kind === 'err' ? ' is-err' : ''),
              children: msg.text,
            })
          : null,
        permMsg.text
          ? h('span', {
              className: 'dsh-pet-cfg__msg' + (permMsg.kind === 'err' ? ' is-err' : ''),
              children: permMsg.text,
            })
          : null,
      ],
    });
  };
}
