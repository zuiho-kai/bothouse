---
name: utils-speechdetection-contracts-01
description: web-frontend utils/speechDetection 源码接口与集成边界 01：silero.worker.ts、sileroVad.ts、speechGate.ts 三个语音检测文件的静态声明与导入（onnxruntime-web、silero_vad_v5.onnx 与 wasm 资源导入、SileroVad、SpeechGate）
metadata:
  scope: 只收这三个语音检测文件的静态声明索引与导入，不证明运行行为；入口说明归 utils-speechdetection-overview
---
# utils-speechdetection 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/utils/speechDetection/silero.worker.ts`**
- 源码声明的类型、组件或调用边界：`scope`, `session`, `state`, `sampleRate`, `pending`, `gate`, `initialize`, `processAudio`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import * as ort from 'onnxruntime-web/wasm';`；`import modelUrl from '../../../node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx?url';`；`import wasmUrl from '../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url';`；
  - `import wasmModuleUrl from '../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/speechDetection/silero.worker.ts#L1-L77)。
- **`jiuwenswarm/channels/web/frontend/src/utils/speechDetection/sileroVad.ts`**
- 源码声明的类型、组件或调用边界：`SileroVad`, `worker`, `timeout`, `fail`, `starting`, `latencyMs`, `inferenceMs`, `detection`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { SpeechDetection } from './speechGate';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/speechDetection/sileroVad.ts#L1-L176)。
- **`jiuwenswarm/channels/web/frontend/src/utils/speechDetection/speechGate.ts`**
- 源码声明的类型、组件或调用边界：`SpeechDetection`, `SpeechGate`, `speech`, `state`, `confirmedFrames`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/speechDetection/speechGate.ts#L1-L57)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/utils-speechdetection/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
