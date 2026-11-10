# components

五个 source owner 的入口与 architecture 页

- [attention](attention/README.md) — Beam attention runtime：GPU/NPU beam attention 与 query/cache layout metadata
- [beam-proc](beam-proc/README.md) — Rust BeamProc runtime：process、worker queues、beam decisions、CE 与 API-server 通信
- [engine-core](engine-core/README.md) — EngineCore beam scheduling：admission、beam state、scheduler replies、CE wire
- [packaging](packaging/README.md) — Native packaging and validation：install metadata、Rust builds、native artifacts
- [serving](serving/README.md) — OpenAI beam serving：beam request/response、BeamProc startup、metrics、cancellation
- [components-overview](components-overview.md) — vLLM-GR component map：按 source owner 选 engine-core、beam-proc、serving…
