/**
 * 余额的共享纯逻辑层入口：解析 /state 里的余额叶子、生成气泡行数据、算宠物档位。
 *
 * 不负责取数——余额由 host 定时刷新并写入 /state（两端共享同一份结果），也不依赖 React 与 DOM。
 * 必须始终成立：不认识任何具体服务商，解析失败返回 null 而不抛异常（1s 轮询里抛一次会打断整拍）。
 *
 * @module dsh-pet/src/shared/balance/index
 */

export * from './types.ts';
export * from './tone.ts';
export * from './parse.ts';
export * from './percent.ts';
export * from './view.ts';
export * from './notice.ts';

// 形态展示规则与公共窗口工具。
export * from './handlers/index.ts';
export * from './handlers/windows.ts';
