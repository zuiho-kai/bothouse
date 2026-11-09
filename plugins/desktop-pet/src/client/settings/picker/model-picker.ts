/**
 * 「AI 模型」单选下拉选择器（碎碎念 / 对话各一个实例）：触发器 + 浮层，一对服务商与模型同时选定。
 * 数据同源于 `GET /models`；打开时实测触发器定位浮层，点浮层外或 Esc 关闭，↑↓/Enter 与鼠标共用一套行清单。
 * 不用两个 `<select>`：既占地方，又容易留下「只选了服务商没选模型」的非法组合；也不提供手填模型 id 的退路。
 * 行清单与浮层定位都在同目录的纯函数里，本文件只管状态、键盘与装配。
 * @module dsh-pet/src/client/settings/picker/model-picker
 */
import type * as ReactNS from 'react';
import type { FunctionComponent } from 'react';
import type { ModelSelection } from '../../../shared/types.ts';
import type { SettingsRuntime } from '../runtime.ts';
import { buildModelRows, selectableIndexes, type ModelCatalogGroup, type ModelRow } from './model-rows.ts';
import { computePanelPlacement, type PanelPosition } from '../panel/placement.ts';
import { buildModelPanel } from './model-picker-panel.ts';

/** 选择器的对外契约：一个字段一个实例。 */
export interface ModelPickerProps {
  /** 字段标签，作为浮层的无障碍名。 */
  label: string;
  /** 当前选择；两者都空 = 跟随当前对话。 */
  value: ModelSelection;
  /** 禁用原因（保存中 / 配置未加载）。 */
  disabled: boolean;
  /** 候选清单；`null` 表示还在拉取。 */
  catalog: readonly ModelCatalogGroup[] | null;
  /** 候选清单拉取失败。 */
  failed: boolean;
  /** 选中一项时回填整对值。 */
  onChange: (value: ModelSelection) => void;
}

/**
 * 造模型选择器。
 * 依赖只在调用时注入一次：组件类型必须跨渲染稳定，否则浮层状态（打开 / 搜索词 / 高亮）每次渲染都会丢。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 选择器组件。
 */
export function makeModelPicker(
  rt: Pick<SettingsRuntime, 'h' | 'useState' | 'useEffect' | 'useRef' | 't'>,
): FunctionComponent<ModelPickerProps> {
  const { h, useState, useEffect, useRef, t } = rt;

  return function ModelPicker(props: ModelPickerProps) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    // 高亮行（键盘 ↑↓ 走的就是它；只停在可选项上）
    const [active, setActive] = useState(0);
    // 浮层位置：打开时按触发器实测一次，空间不够就翻到上方
    const [pos, setPos] = useState<PanelPosition | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);

    const groups = props.catalog ?? [];
    const group = groups.find((g) => g.id === props.value.provider);
    const picked = group?.models.find((m) => m.id === props.value.model);
    const isFollow = props.value.provider === '';
    const triggerLabel = isFollow ? t('modelFollow') : (picked?.name ?? props.value.model);
    // 当前配置不在清单里（服务商下线 / 模型下架）时如实标注，绝不显示成别的模型
    const triggerSub = isFollow ? '' : (group?.name ?? props.value.provider + t('modelUnknown'));

    const rows = buildModelRows(groups, query);
    const selectable = selectableIndexes(rows);

    const commit = (value: ModelSelection): void => {
      props.onChange(value);
      setOpen(false);
      setQuery('');
    };
    const pick = (row: ModelRow | undefined): void => {
      if (!row) return;
      if (row.kind === 'follow') commit({ provider: '', model: '' });
      else if (row.kind === 'model') commit({ provider: row.provider, model: row.model.id });
    };
    const step = (dir: number): void => {
      if (selectable.length === 0) return;
      const at = selectable.indexOf(active);
      const next = selectable[at < 0 ? 0 : (at + dir + selectable.length) % selectable.length];
      setActive(next);
      panelRef.current?.querySelector('[data-row="' + next + '"]')?.scrollIntoView({ block: 'nearest' });
    };

    useEffect(() => {
      if (!open) return;
      const el = rootRef.current;
      // 定位 + 关闭时机：浮层脱离文档流实测定位，滚动/缩放跟着走，点外面或 Esc 关。
      const place = (): void => {
        if (!el) return;
        setPos(
          computePanelPlacement(el.getBoundingClientRect(), {
            width: window.innerWidth,
            height: window.innerHeight,
          }),
        );
      };
      place();
      // 打开即聚焦搜索框（DSH 同样把焦点交给搜索）
      panelRef.current?.querySelector('input')?.focus();
      const onDown = (e: MouseEvent): void => {
        const target = e.target as Node | null;
        if (target && (rootRef.current?.contains(target) === true || panelRef.current?.contains(target) === true)) {
          return;
        }
        setOpen(false);
      };
      const onKey = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') setOpen(false);
      };
      document.addEventListener('mousedown', onDown, true);
      document.addEventListener('keydown', onKey, true);
      window.addEventListener('scroll', place, true);
      window.addEventListener('resize', place);
      return () => {
        document.removeEventListener('mousedown', onDown, true);
        document.removeEventListener('keydown', onKey, true);
        window.removeEventListener('scroll', place, true);
        window.removeEventListener('resize', place);
      };
    }, [open]);

    const toggle = (): void => {
      if (props.disabled) return;
      if (!open) {
        setQuery('');
        // 打开时高亮停在当前选择上（DSH 打开菜单也是先定位到已选项）
        const at = rows.findIndex(
          (r) => r.kind === 'model' && r.provider === props.value.provider && r.model.id === props.value.model,
        );
        setActive(at >= 0 ? at : 0);
      }
      setOpen(!open);
    };

    const panel =
      open && pos
        ? buildModelPanel({
            h,
            t,
            label: props.label,
            disabled: props.disabled,
            catalog: props.catalog,
            failed: props.failed,
            rows,
            active,
            query,
            value: props.value,
            pos,
            panelRef,
            onQueryChange: (value) => {
              setQuery(value);
              setActive(selectable.length > 0 ? selectable[0] : 0);
            },
            onPick: pick,
            onHover: setActive,
            onKeyDown: (event: ReactNS.KeyboardEvent<HTMLInputElement>) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                step(1);
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                step(-1);
              } else if (event.key === 'Enter') {
                event.preventDefault();
                pick(rows[active]);
              }
            },
          })
        : null;

    return h('div', {
      ref: rootRef,
      className: 'dsh-pet-mp',
      children: [
        h('button', {
          key: 'trigger',
          type: 'button',
          className: 'dsh-pet-mp__trigger',
          disabled: props.disabled,
          'aria-haspopup': 'menu',
          'aria-expanded': open,
          'aria-label': t('modelTriggerAria').replace('{model}', triggerLabel),
          onClick: toggle,
          children: [
            h('span', { key: 'l', className: 'dsh-pet-mp__label', children: triggerLabel }),
            triggerSub ? h('span', { key: 's', className: 'dsh-pet-mp__sub', children: triggerSub }) : null,
            h('span', { key: 'c', className: 'dsh-pet-mp__chevron' + (open ? ' is-open' : ''), children: '▾' }),
          ],
        }),
        panel,
      ],
    });
  };
}
