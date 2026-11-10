---
name: feature-depth-video-agent-managed-task-service
description: Managed Agent Task Service 实现深读：kick() 并发调度、submit 输入校验、VideoSearchManager.service 懒构造、answer() 过期问题处理、仅最新快照通知、重试去重单测、store 与 sqlite3 依赖
metadata:
  scope: 只收 TaskService 调度、submit/answer 校验、通知合并与 store 依赖的实现级证据；功能概览归 feature-video-agent-managed-task-service
---
# Voice/Video Duplex Managed Agent Task Service (Durable Queue, Concurrency, Uncertainty Semantics)：实现深读

## 现状

- [[feature-video-agent-managed-task-service]]（功能概览） · [[extensions-plugins-overview]]（owner 入口）
- **kick() dispatches queued tasks up to concurrency after an immediate transaction snapshot** When started and not closed, kick() reads all tasks in one store transaction, collects active ones (running/cancelling/unknown/waiting_user or already having a worker),
  - then iterates tasks by position: once the count of active tasks that are not unknown and not settled waiting_user reaches self.concurrency it breaks;
  - queued tasks not already in self.workers and passing _ready get an asyncio.create_task(self._drain(id)) worker registered in self.workers with a _worker_done callback.
- 来源：[jiuwenswarm/extensions/video_duplex/backend/tasks/service.py:L79–L113](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/tasks/service.py#L79-L113)
- **submit input contract: strict ValueError validation before persistence** submit(owner, session, command_id, instruction, request=None) requires a string owner, non-empty session, non-blank instruction ≤16000 chars, boolean independent,
  - and depends_on/resources lists ≤32 entries of non-blank strings ≤256 chars; violations raise ValueError.
- 来源：[jiuwenswarm/extensions/video_duplex/backend/tasks/service.py:L183–L210](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/tasks/service.py#L183-L210)
- **VideoSearchManager.service lazily builds TaskService with self.concurrency and a derived notification_timeout** On first access the service property constructs
  - TaskService(TaskStore(self.path or task_database()), AgentTaskExecutor(...), on_change=self.changed, concurrency=self.concurrency, notification_timeout=AGENT_QUERY_TIMEOUT + 2 * EVENT_SEND_TIMEOUT + 1), caching it in self._service.
  - The shown lines do not establish defaults for self.concurrency or the timeout constants.
- 来源：[jiuwenswarm/extensions/video_duplex/backend/task_adapter.py:L283–L293](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/task_adapter.py#L283-L293)
- **answer() rejects stale questions and marks failed executor answers unknown** answer raises ValueError("Question is no longer pending for this task") unless status is waiting_user with a matching pending interaction id; if executor.answer throws,
  - it sets status="unknown" with the error (only while still running with same request_id) and re-raises.
- 来源：[jiuwenswarm/extensions/video_duplex/backend/tasks/service.py:L491–L533](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/tasks/service.py#L491-L533)
- **Latest-snapshot-only notifications avoid client backpressure at the cost of coalescing updates** 设计推断（非作者历史意图）：
- _notify stores only the newest task snapshot per task id (pending_notifications[key] = task) and runs a single sender task per key; the comment states slow clients must not backpressure agent output or grow an unbounded queue.
  - Inferred cost: intermediate snapshots between sends are overwritten, so a client may never see them.
- 来源：[jiuwenswarm/extensions/video_duplex/backend/tasks/service.py:L582–L591](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/tasks/service.py#L582-L591)
- **Runtime test: retry dedup, conflict ValueError, owner/session scoping** test_retry_conflict_scope_and_cancel_before_dispatch asserts submit with the same command_id and text returns the same id, differing text raises ValueError, wrong owner/session get/cancel raise ValueError,
  - and cancel before dispatch never reaches the executor. NOT EXECUTED here.
- 来源：[jiuwenswarm/extensions/video_duplex/tests/backend/test_managed_tasks.py:L69–L84](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/tests/backend/test_managed_tasks.py#L69-L84)
- **submit 依赖注入的 store 的 get/put/command；store.transaction 依赖 sqlite3（timeout=10、BEGIN IMMEDIATE）** submit（回放未命中时）调用注入的 self.store.get 校验 depends_on 依赖、put 持久化任务、command 记录 command_id 回执，随后 kick() 并返回 task。
  - store.transaction 以 sqlite3.connect(path, timeout=10) 开连接，执行 BEGIN IMMEDIATE 后 yield db 并 commit；BaseException 时 rollback 并 re-raise，finally 中关闭连接。所示行不证明 submit 进入 transaction。
- 来源：[jiuwenswarm/extensions/video_duplex/backend/tasks/service.py:L219–L236](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/tasks/service.py#L219-L236),
  - [jiuwenswarm/extensions/video_duplex/backend/tasks/store.py:L36–L48](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/tasks/store.py#L36-L48)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/extensions-plugins/feature-depth-video-agent-managed-task-service.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/tasks/service.py:L183-L210；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/tasks/service.py:L491-L533
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/tests/backend/test_managed_tasks.py:L69-L84
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/tasks/service.py:L79-L113；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/task_adapter.py:L283-L293
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/tasks/service.py:L582-L591；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/tasks/service.py:L219-L236
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/tasks/store.py:L36-L48
- 源页字段（feature）：video-agent-managed-task-service
- 入口（entry_points）：jiuwenswarm/extensions/video_duplex/backend/tasks/service.py
- 源页字段（source_globs）：jiuwenswarm/extensions/video_duplex/backend/tasks/service.py；jiuwenswarm/extensions/video_duplex/backend/tasks/rail.py
