/**
 * 配置读写层的出口：成品解析、HTTP 契约、保存 / 同步编排、加载状态与保存前校验。
 * 外部只经这里取用，不深路径引用组内文件——换实现时只改这一处。
 * @module dsh-pet/src/client/settings/config
 */
export {
  type ConfigEntry,
  type MainConfigPatch,
  type MergedConfig,
  readConfigEntries,
  readMainConfig,
} from './read.ts';
export {
  buildSaveBody,
  type ConfigMeta,
  loadConfig,
  loadMeta,
  loadModelCatalog,
  type PetLayerOutcome,
  saveConfig,
  type SaveFields,
  savePetLayer,
  syncConfig,
} from './http.ts';
export { diffPackWrites, type PackWrite } from './pack-writes.ts';
export { persistSettings, type SaveResult, syncSettings } from './persist.ts';
export { createWriteFlow, type WriteFlow, type WriteFlowDeps } from './write-flow.ts';
export { type ConfigLoad, type LoadState, useConfigLoad } from './use-config-load.ts';
export { type FormValues, type InvalidKey, modelPairValid, validateForm } from './validate-form.ts';
