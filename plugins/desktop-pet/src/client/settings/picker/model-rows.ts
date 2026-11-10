/**
 * 模型选择器的纯视图模型：把「候选清单 + 搜索词」折成一行一行可渲染的清单，并给出键盘可走的行号。
 * 不碰 DOM、不持有状态；搜索语义（大小写不敏感的有序子序列）与 DSH 自带的模型选择器一致。
 * 行顺序固定为：跟随当前对话（仅无搜索词时）→ 各服务商分组头 → 组内命中的模型，或该组「没有可用模型」。
 * @module dsh-pet/src/client/settings/picker/model-rows
 */

/** 候选清单里的一组：一个服务商及它名下的模型（`GET /models` 的响应形态）。 */
export interface ModelCatalogGroup {
  id: string;
  name: string;
  models: Array<{ id: string; name: string }>;
}

/** 选择器浮层里的一行：跟随当前对话、服务商分组头、模型或「该服务商没有可用模型」。 */
export type ModelRow =
  | { kind: 'follow'; key: string }
  | { kind: 'group'; key: string; name: string }
  | { kind: 'none'; key: string }
  | { kind: 'model'; key: string; provider: string; model: { id: string; name: string } };

/**
 * 搜索词是否命中：大小写不敏感的有序子序列匹配，空搜索词命中一切。
 * @param text - 被搜索的文本，通常是「模型名 + 空格 + 模型 id」。
 * @param query - 用户输入；两侧空白忽略。
 * @returns 命中返回 true；字符顺序不对或字符不全返回 false。
 */
export function matchModelQuery(text: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  let at = 0;
  for (const char of text.toLowerCase()) {
    if (char === needle[at]) at += 1;
    if (at >= needle.length) return true;
  }
  return false;
}

/**
 * 把候选清单折成可渲染的行。
 *
 * @param groups - 候选清单；`[]` 表示宿主没有可用服务商。
 * @param query - 搜索词；为空时多出「跟随当前对话」一行。
 * @returns 行清单；分组头与「没有可用模型」行不可选，见 {@link selectableIndexes}。
 */
export function buildModelRows(groups: readonly ModelCatalogGroup[], query: string): ModelRow[] {
  const needle = query.trim().toLowerCase();
  const rows: ModelRow[] = [];
  // 「跟随当前对话」不是一个模型，只在没搜索词时出现。
  if (needle === '') rows.push({ kind: 'follow', key: '__follow' });
  for (const group of groups) {
    const models = group.models.filter((model) => matchModelQuery(model.name + ' ' + model.id, needle));
    // 有搜索词时，整组没命中就整组不显示；无搜索词时，空组要留下分组头去挂「没有可用模型」。
    if (models.length === 0 && !(needle === '' && group.models.length === 0)) continue;
    rows.push({ kind: 'group', key: group.id, name: group.name });
    if (models.length === 0) {
      rows.push({ kind: 'none', key: group.id + '/__none' });
      continue;
    }
    for (const model of models) {
      rows.push({ kind: 'model', key: group.id + '/' + model.id, provider: group.id, model });
    }
  }
  return rows;
}

/**
 * 键盘 ↑↓ 只能停在可选项上：分组头与提示行跳过。
 *
 * @param rows - {@link buildModelRows} 的输出。
 * @returns 可选行的下标，递增排列。
 */
export function selectableIndexes(rows: readonly ModelRow[]): number[] {
  return rows.map((row, index) => (row.kind === 'group' || row.kind === 'none' ? -1 : index)).filter((i) => i >= 0);
}
