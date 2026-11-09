/**
 * 第三方菜单的页面内镜像：这一页有哪些菜单项、哪一项被点了，按 owner 分键，形状与宿主 registry 一致。
 * 不做长轮询：读取即消费，返回与 `GET /menu/events` 同形的结果，消费方换调用不用换解析。
 * 页面级状态，标签页之间不共享；`/state` 首拍之前没有项，任何 owner 都算未知。
 * @module dsh-pet/src/client/menu-service
 */

/** 一个 owner 的点击映射：label → 被哪只宠物点了（null = 未点）。 */
export type MenuMarks = Record<string, string | null>;

/** 读取结果：与 `GET /menu/events` 的响应体同形。 */
export type MenuEventsResult = { ok: true; events: MenuMarks } | { ok: false; reason: 'unknown-owner' };

/** owner → 本页可见的 label 列表（来源是 /state 的 sections.menu 快照）。 */
const labels = new Map<string, string[]>();

/** owner → 每项的点击闩锁（连点两次同一条只留最后一次，与宿主一致）。 */
const marks = new Map<string, Map<string, string | null>>();

/**
 * 用最新快照替换本页的菜单项（唯一调用点是 pet/multi 更新菜单快照处）。
 *
 * @param items - 本端可见的第三方菜单项；整体覆盖，不保留上一次的项。
 */
export function setMenuItems(items: readonly { owner: string; label: string }[]): void {
  labels.clear();
  for (const item of items) {
    const list = labels.get(item.owner);
    if (list === undefined) labels.set(item.owner, [item.label]);
    else if (!list.includes(item.label)) list.push(item.label);
  }
  // 闩锁跟着项走：已下线项的标记不再可读，避免 owner 重注册后读到上一次的残留。
  for (const [owner, entry] of marks) {
    const list = labels.get(owner);
    if (list === undefined) {
      marks.delete(owner);
      continue;
    }
    for (const label of [...entry.keys()]) {
      if (!list.includes(label)) entry.delete(label);
    }
  }
}

/**
 * 记下一次点击（渲染端派发第三方项时调）。
 *
 * owner 还没进快照也照记：`/state` 可能晚一拍，丢掉这一下就再也拿不到了。
 *
 * @param owner - 注册方身份。
 * @param label - 被点的项名。
 * @param pet - 在哪只宠物上点的。
 */
export function setMenuClick(owner: string, label: string, pet: string): void {
  let entry = marks.get(owner);
  if (entry === undefined) {
    entry = new Map();
    marks.set(owner, entry);
  }
  entry.set(label, pet);
}

/**
 * 读取并消费：返回与 `GET /menu/events` 同形的结果，读走后所有标记清回 null。
 *
 * @param owner - 注册方身份。
 * @returns 本页可见的项及其点击结果；这个 owner 在本页没有项时是 `unknown-owner`。
 */
export function takeMenuEvents(owner: string): MenuEventsResult {
  const list = labels.get(owner);
  if (list === undefined) return { ok: false, reason: 'unknown-owner' };
  const entry = marks.get(owner);
  const events: MenuMarks = {};
  for (const label of list) {
    events[label] = entry?.get(label) ?? null;
    entry?.set(label, null);
  }
  return { ok: true, events };
}

/** 清空本页的菜单镜像；测试用。 */
export function resetMenuEvents(): void {
  labels.clear();
  marks.clear();
}
