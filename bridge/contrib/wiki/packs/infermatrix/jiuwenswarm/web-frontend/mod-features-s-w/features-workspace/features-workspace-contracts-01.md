---
name: features-workspace-contracts-01
description: web-frontend features-workspace 源码接口与集成边界 01：src/features/workspace 下 archivedTaskClient、archivedTaskGrouping、localFilePicker、projectDirectoryPicker、projectRegistryClient、projectTypes、workModeStorage 共七个前端文件的静态声明与导入
metadata:
  scope: 只收这七个 workspace 前端文件的静态声明索引与导入，不证明运行行为；入口说明归 features-workspace-overview
---
# features-workspace 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/features/workspace/archivedTaskClient.ts`**
- 源码声明的类型、组件或调用边界：`ArchivedSession`, `ArchivedListResponse`, `ArchivedSessionListResponse`, `ArchiveWarning`, `ArchivedListParams`, `BatchSessionResultEntry`, `BatchSessionArchiveResponse`, `ArchiveRequest`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { webRequest } from '../../services/webClient';`；`import type { WorkMode } from './projectTypes';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/workspace/archivedTaskClient.ts#L1-L186)。
- **`jiuwenswarm/channels/web/frontend/src/features/workspace/archivedTaskGrouping.ts`**
- 源码声明的类型、组件或调用边界：`ArchivedTaskGroup`, `UNASSIGNED_GROUP_KEY`, `buildArchivedTaskGroups`, `groups`, `groupByKey`, `ensureGroup`, `group`, `session`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/workspace/archivedTaskGrouping.ts#L1-L137)。
- **`jiuwenswarm/channels/web/frontend/src/features/workspace/localFilePicker.ts`**
- 源码声明的类型、组件或调用边界：`LocalFilePick`, `LocalFilePickResult`, `DESKTOP_LOCAL_FILES_EVENT`, `DESKTOP_READY_EVENT`, `DESKTOP_FILE_DRAG_EVENT`, `DESKTOP_DIRECTORY_DROP_REJECTED_EVENT`, `DESKTOP_VIRTUAL_FILE_DROP_REJECTED_EVENT`, `DesktopLocalFilesEventDetail`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/workspace/localFilePicker.ts#L1-L415)。
- **`jiuwenswarm/channels/web/frontend/src/features/workspace/projectDirectoryPicker.ts`**
- 源码声明的类型、组件或调用边界：`ProjectDirectoryPickResult`, `ProjectFilePickResult`, `SelectProjectFileOptions`, `DIRECTORY_PICKER_TIMEOUT_MS`, `FILE_PICKER_TIMEOUT_MS`, `getProjectDirectoryApi`, `getProjectFileApi`, `isProjectDirectoryPickerSupported`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/workspace/projectDirectoryPicker.ts#L1-L171)。
- **`jiuwenswarm/channels/web/frontend/src/features/workspace/projectRegistryClient.ts`**
- 源码声明的类型、组件或调用边界：`ProjectSessionBatchResult`, `ProjectRemoveResult`, `projectRegistryClient`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { webRequest } from '../../services/webClient';`；`import type { Session } from '../../types';`；`import type { ProjectInfo, WorkMode } from './projectTypes';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/workspace/projectRegistryClient.ts#L1-L57)。
- **`jiuwenswarm/channels/web/frontend/src/features/workspace/projectTypes.ts`**
- 源码声明的类型、组件或调用边界：`WorkMode`, `ProjectGitSnapshot`, `ProjectInfo`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/workspace/projectTypes.ts#L1-L29)。
- **`jiuwenswarm/channels/web/frontend/src/features/workspace/workModeStorage.ts`**
- 源码声明的类型、组件或调用边界：`WORK_MODE_STORAGE_KEY`, `DEFAULT_WORK_MODE`, `readStoredWorkMode`, `persistWorkMode`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { WorkMode } from './projectTypes';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/workspace/workModeStorage.ts#L1-L22)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/features-workspace/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
