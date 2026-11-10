---
name: rules-app-assembly
description: "规则 SERV-5s：assembled FastAPI app 用 Omni handler 覆盖 upstream HTTP route 前，先用 endpoint_policy.remove_route_from_app(app, path, methods) 移除同 method/path 的旧 route；/start_profile、/stop_profile 与 build_openai_app() 的 GET /health 所有权（PR #6609、#6707、#6723）"
metadata:
  scope: 只收 SERV-5s 这一条 route 覆盖与 method/path ownership 规则；endpoint restriction 与公开 400 的请求合同（SERV-4c、SERV-4d）归 rules-request-input-1、rules-request-input-2，规则组总表归 serving-rules-1
---
# Serving app assembly 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/serving/rules-app-assembly.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, serving；created: 2026-09-04；updated: 2026-09-05
- 来源（sources）：PR #6609；PR #6707；PR #6723；vllm_omni/config/endpoint_policy.py；vllm_omni/entrypoints/openai/api_server.py；tests/config/test_endpoint_policy.py；tests/entrypoints/openai/test_profiler_endpoints.py；tests/entrypoints/openai_api/test_api_server_guards.py
- 置信度（confidence）：high
- [SERV-5s] 覆盖 upstream HTTP route 前必须先移除同 method/path 的旧 route
  - 触发：assembled app 用 Omni handler 覆盖 upstream HTTP endpoint，尤其是附带可选 request body 或 stage scope 的 conditional router。
  - 强制：唯一公开 helper `endpoint_policy.remove_route_from_app(app, path, methods)` 的 `methods` 为必传的 method set、没有 `None`/wildcard 语义；它只移除 `Route`、path 精确相等、`route.methods` 非 `None` 且与所给 set 相交的条目，保留非 `Route`、不同 path 与 method 不相交的 routes。
    - API server 必须导入此 helper，不得保留第二份实现或由 endpoint policy 反向导入 API server。调用在 `include_router()` 前，并置于 feature 启用的同一条件分支；用于 endpoint restrictions 与 API/profiler overrides。FastAPI/Starlette 不会因后注册同 path/method 而替换旧 route，dispatch 会命中先注册者。
  - 验收：unit test 构造同 path 的 `Route`（相交和不相交 methods）及非 `Route`，断言仅移除相交者；assembly test 验证 API server 使用同一 helper、没有本地 duplicate/circular import，并为 upstream 和 Omni 注册相同 method/path 后断言仅剩 Omni endpoint。公开 endpoint test 发送 `stages` 并断言 engine client 收到原值。`/start_profile` 与 `/stop_profile` 是当前实例。
    - PR #6707 现有测试没有直接 method partition 或 API assembly 覆盖；review 的批准边界是 static review、merge tree 与 CI，不能据此作 broad compatibility/E2E 声明。^[PR #6609] ^[PR #6707, merged 2026-09-02]
  - 已修复边界：`build_openai_app()` 若先注册 upstream `GET /health`，必须在 `app.include_router(router)` 前用 `remove_route_from_app(app, "/health", {"GET"})` 从 assembled app 删除它；router-local 的预先删除发生在本地 health route 注册前，是 no-op。最终 assembled app 只保留一个 `GET /health`，并由 Omni `health` handler 所有；
    - 这不改变 native vLLM 的 render-only health route。现有证据仅为 CPU assembly guard：fake upstream health 后以 route count 和 endpoint identity 锁定所有权，不构成 server E2E 或 render-only 200/503 语义验证。^[PR #6723, merged 2026-09-03]

## 决策与踩坑

- [SERV-5s] 禁止：只检查 router 自身存在，或只断言 HTTP 200；这不能证明 assembled app 没有重复 route，也不能证明 request body 到达 Omni handler。
