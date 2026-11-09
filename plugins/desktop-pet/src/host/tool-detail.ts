/**
 * 工具详情文案的公开出口：把一次工具调用折叠成气泡里的一句话。
 *
 * 只做再导出，数据在 ./tool-detail/copy，解析在 ./tool-detail/target。
 * 必须始终成立：气泡是上屏内容，参数值一律不出现。
 * @module dsh-pet/src/host/tool-detail
 */
export { toolDetailFromEvent } from './tool-detail/detail.ts';
