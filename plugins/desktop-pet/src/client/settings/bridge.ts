/**
 * 容器（宠物页面）与设置页共享的桥：同一 bundle 内的单例，交换当前宠物列表与重载入口。
 * `current` 是最新成品拍平列表，只有容器写入；`reload` 由容器注册，缺省为空函数，设置页可在容器装配前先保存。
 * `template` 是 main 条目的首只宠物，给「添加宠物」当新实例的初值。
 * @module dsh-pet/src/client/settings/bridge
 */
import type { Pet } from '../../shared/types.ts';

/** 桥的唯一实例；字段是可变的，写入方各自固定（容器写 current / reload，设置页只读）。 */
export const petBridge: {
  current: Pet[];
  reload: (merged?: Record<string, Record<string, unknown>>) => void;
  template: Pet | undefined;
} = {
  current: [],
  reload: () => {},
  template: undefined,
};
