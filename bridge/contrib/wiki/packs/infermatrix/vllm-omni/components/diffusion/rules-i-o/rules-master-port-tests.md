---
name: rules-master-port-tests
description: "Diffusion 规则 VLLM-OMNI-PR9219-MASTER-PORT-TESTS：test_omni_diffusion_config_master_port.py 的候选端口测试打桩 vllm_omni.diffusion.data.is_port_available、用固定常量并断言探测序列（env 优先、busy-port +37 步进），默认端口路径保留 127.0.0.1 上至多 10 次的 resolve-and-bind 重试（PR #9219，起因 #9208）"
metadata:
  scope: 只收 OmniDiffusionConfig master_port 测试写法这一条规则；不覆盖生产侧 vllm_omni/diffusion/data.py 的 _resolve_master_port / settle_port 语义
---
# Diffusion master-port 测试规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/diffusion/rules-master-port-tests.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, diffusion；created: 2026-10-26；updated: 2026-10-26
- 来源（sources）：PR #9219
- [VLLM-OMNI-PR9219-MASTER-PORT-TESTS] master_port 测试不依赖未预留端口：stub is_port_available 并断言探测序列
  - 触发：改动 `tests/diffusion/test_omni_diffusion_config_master_port.py`（`OmniDiffusionConfig` 的 `MASTER_PORT` env 优先于 kwarg、显式 kwarg 稳定性、默认端口可用性、busy-port settle 步进各测试），或在该文件中重新引入以 `get_open_port()` 返回值做等值断言或真实 bind 的测试写法；
    - 不覆盖生产解析 `vllm_omni/diffusion/data.py` 的 `_resolve_master_port` / `settle_port` 语义本身。
  - 强制：候选端口选择类测试（env 优先、kwarg 稳定、busy-port +37 步进）必须打桩 `vllm_omni.diffusion.data.is_port_available`（经 data 模块内导入的名称 monkeypatch），使用互不相同且异于单次 +37 步长的固定常量（`_ENV_PORT`/`_KWARG_PORT`/`_EXPLICIT_PORT`），并断言打桩记录的探测序列恰为期望值——env 优先用例断言结果等于 env 端口且 `checked == [_ENV_PORT]`（kwarg 不得被查询），
    - busy 用例断言结果为 `busy_port + 37` 且 `checked == [busy_port, busy_port + 37]`——使测试在端口被 CI 并发抢占时仍然确定（#9208 的失败即 `get_open_port()` 返回值未预留、被抢后 settle +37 导致断言不等）。
    - 默认端口路径不打桩：该路径仍走 live `get_open_port()`，须保留 bounded resolve-and-bind 重试（至多 10 次），仅在 `127.0.0.1` 上绑定（CodeQL 会标记 wildcard bind），重试耗尽以 `pytest.fail` 报告最后错误。生产解析保持不变。
  - 验收：`pytest tests/diffusion/test_omni_diffusion_config_master_port.py -q` 全绿（当前 6 项）；优先级与步进用例均带探测序列断言；默认路径用例为 loopback 上的 bounded 重试；`ruff check` 与 `ruff format --check` 通过。^[PR #9219]

## 决策与踩坑

- [VLLM-OMNI-PR9219-MASTER-PORT-TESTS] 禁止：断言 `config.master_port == get_open_port()` 之类对未预留端口的等值比较；在候选选择测试中保留真实 bind 或 wildcard bind（`bind(("", ...))`）；删除对探测序列的断言使解析停止查询可用性检查时测试仍通过；为迁就测试改动生产 `settle_port` 的步进或优先级语义。
