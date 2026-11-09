/**
 * 宠物标签条：当前种类的每只实例一个按钮（显示名字与宽度），末尾是「添加宠物」。
 * 只负责「选中谁」与「加一只」，增删的合法性由设置页外壳判断。
 * @module dsh-pet/src/client/settings/pet-tabs
 */
import type { FunctionComponent } from 'react';
import type { Pet } from '../../shared/types.ts';
import type { SettingsRuntime } from './runtime.ts';

/** 标签条的输入。 */
export interface PetTabsProps {
  /** 当前种类的实例列表。 */
  pets: readonly Pet[];
  /** 当前选中的宠物 id。 */
  selId: string;
  /** 保存中或配置未就绪时禁用「添加」。 */
  busy: boolean;
  /** 切到另一只宠物。 */
  onSelect: (id: string) => void;
  /** 往当前种类加一只新实例。 */
  onAdd: () => void;
}

/**
 * 造宠物标签条。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 标签条组件。
 */
export function makePetTabs(rt: Pick<SettingsRuntime, 'h' | 't'>): FunctionComponent<PetTabsProps> {
  const { h, t } = rt;

  return function PetTabs(props: PetTabsProps) {
    return h('div', {
      className: 'dsh-pet-cfg__tabs',
      children: [
        h('span', { key: 'label', className: 'dsh-pet-cfg__tabsLabel', children: t('petsLabel') }),
        ...props.pets.map((pet) =>
          h('button', {
            key: pet.id,
            type: 'button',
            onClick: () => props.onSelect(pet.id),
            className: 'dsh-pet-cfg__tab' + (pet.id === props.selId ? ' is-active' : ''),
            children:
              (pet.name || pet.id) +
              ' (' +
              pet.size +
              'px' +
              (pet.sizePercent === undefined || pet.sizePercent >= 100 ? '' : ' / ' + pet.sizePercent + '%') +
              ')',
          }),
        ),
        h('button', {
          key: 'add',
          type: 'button',
          onClick: props.onAdd,
          disabled: props.busy,
          className: 'dsh-pet-cfg__tab is-ghost',
          children: '+ ' + t('add'),
        }),
      ],
    });
  };
}
