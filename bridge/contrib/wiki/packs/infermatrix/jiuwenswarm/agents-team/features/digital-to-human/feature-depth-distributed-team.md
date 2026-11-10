---
name: feature-depth-distributed-team
description: 跨进程分布式 Team 实现深读：normalize_distributed_transport_fields 契约、端口默认值与非法端口 ValueError、pyzmq/asyncpg 依赖探测、PostgreSQL 条件启动与退避轮询、单测入口
metadata:
  scope: 只收分布式传输字段归一化、依赖探测与 PostgreSQL 就绪轮询的实现细节；功能概览归 feature-distributed-team
---
# 跨进程分布式 Team：实现深读

## 现状

- [[feature-distributed-team]]（功能概览） · [[agents-team-overview-1]]、[[agents-team-overview-2]]（owner 入口）
- **归一化函数契约** normalize_distributed_transport_fields(config_base, team_cfg) 返回 team_cfg 的深拷贝（L78 deepcopy），不修改调用方传入的 team_cfg；调用方义务是同时提供全局 config_base（用于解析 runtime.role）和 team 配置，并使用返回值而非原地读取入参。
- 来源：[jiuwenswarm/agents/harness/team/distributed_runtime.py:L74–L81](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/distributed_runtime.py#L74-L81),
  - [tests/unit_tests/agentserver/test_distributed_runtime.py:L54–L59](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_distributed_runtime.py#L54-L59)
- **端口默认值与角色缺省** leader 侧 direct_port/pub_port/sub_port 缺省分别为 18555/18556/18557，teammate direct_port 缺省 18600（L101-131）；端口值为 None 或空白字符串时回落到默认值，host 缺省 127.0.0.1（L100）。team.runtime.role 缺省为 "leader"。
- 来源：[jiuwenswarm/agents/harness/team/distributed_runtime.py:L100–L131](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/distributed_runtime.py#L100-L131),
  - [jiuwenswarm/agents/harness/team/distributed_runtime.py:L53–L59](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/distributed_runtime.py#L53-L59),
  - [jiuwenswarm/agents/harness/team/distributed_runtime.py:L31–L35](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/distributed_runtime.py#L31-L35)
- **非法端口触发 ValueError** parse_port 对无法 int() 的值（如 "abc"）或超出 1..65535 的值抛出 ValueError，消息为 "Invalid {field_name}: {value!r}. Expected an integer in range 1..65535."（L64-70）；None 或空白字符串不报错而是返回默认端口。
- 来源：[jiuwenswarm/agents/harness/team/distributed_runtime.py:L53–L71](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/distributed_runtime.py#L53-L71),
  - [tests/unit_tests/agentserver/test_distributed_runtime.py:L97–L104](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_distributed_runtime.py#L97-L104)
- **单元测试入口** `tests/unit_tests/agentserver/test_distributed_runtime.py` 覆盖：leader 在 pubsub 已预填时仍移除 `known_peers`（L11-33）；归一化不改写入参且补全地址/`pubsub_bind=True`（L36-67）；teammate 生成唯一指向 leader 的 `known_peers`（L70-90）；`parse_port` 对空白串取默认、对非数字和越界值抛带字段名/范围的 `ValueError`（L93-104）。这些断言描述测试所固化的行为，不代表本次已运行通过。
- 来源：[tests/unit_tests/agentserver/test_distributed_runtime.py:L11–L33](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_distributed_runtime.py#L11-L33),
  - [tests/unit_tests/agentserver/test_distributed_runtime.py:L70–L104](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_distributed_runtime.py#L70-L104)
- **分布式模式下按 find_spec 探测 pyzmq 与（仅 PG 存储时）asyncpg** missing_distributed_dependencies 仅在 is_distributed_mode（runtime.mode 为 distributed 或 transport.type 为 pyzmq）时检查：find_spec 找不到 zmq 记 pyzmq；storage.type 为 postgresql/postgres 且找不到 asyncpg 时另记 asyncpg；非分布式配置返回空列表，即 asyncpg 只对 PG 存储的分布式配置被列为缺失项。
- 来源：[jiuwenswarm/agents/harness/team/distributed_runtime.py:L20–L28](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/distributed_runtime.py#L20-L28),
  - [jiuwenswarm/agents/harness/team/distributed_runtime.py:L154–L157](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/distributed_runtime.py#L154-L157),
  - [jiuwenswarm/agents/harness/team/distributed_runtime.py:L160–L172](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/distributed_runtime.py#L160-L172)
- **pg_isready 失败后自动拉起 PostgreSQL 的便利与启动均失败时未确认即返回的代价** 设计推断（非作者历史意图）：
- 收益（推断）：pg_isready 探测失败后，leader 依次尝试 try_start_pg_cluster 与 ('systemctl','start','postgresql')/('service','postgresql','start')，可免去手工先起库。成本（推断）：若这些命令均未成功，该分支仅 logger.warning 后返回 None，本函数内不抛错，端点就绪未得到确认。
- 来源：[jiuwenswarm/agents/harness/team/distributed_runtime.py:L282–L291](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/distributed_runtime.py#L282-L291),
  - [jiuwenswarm/agents/harness/team/distributed_runtime.py:L319–L412](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/distributed_runtime.py#L319-L412)
- **leader 且 PostgreSQL storage 下不可达端点的条件启动与按退避就绪轮询** 仅当 runtime_role(config_base) 为 "leader" 且 team 配置判定为 PostgreSQL storage 时继续，否则返回；端点探测已可用也直接返回。不可达时先尝试集群启动，未成功再依次尝试 systemctl/service，首个 rc==0 即生效；全部启动命令失败则记录 warning 并返回，不进入轮询。仅启动命令成功后才在默认 30 秒期限内带退避轮询就绪，就绪即返回，到期仍不可用记录 warning 后返回。
- 来源：[jiuwenswarm/agents/harness/team/distributed_runtime.py:L319–L412](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/distributed_runtime.py#L319-L412)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-depth-distributed-team.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_distributed_runtime.py:L11-L33；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_distributed_runtime.py:L70-L104
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/distributed_runtime.py:L74-L81；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_distributed_runtime.py:L54-L59
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/distributed_runtime.py:L100-L131；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/distributed_runtime.py:L53-L59
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/distributed_runtime.py:L31-L35；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/distributed_runtime.py:L53-L71
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_distributed_runtime.py:L97-L104；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/distributed_runtime.py:L20-L28
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/distributed_runtime.py:L154-L157；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/distributed_runtime.py:L160-L172
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/distributed_runtime.py:L282-L291；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/distributed_runtime.py:L319-L412
- 源页字段（feature）：distributed-team
- 入口（entry_points）：jiuwenswarm/agents/harness/team/distributed_runtime.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/team/distributed_runtime.py
