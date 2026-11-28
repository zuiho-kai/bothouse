"""Tool: manage Feishu task topic, main-group progress card, stuck alerts, and delivery checks."""
from __future__ import annotations

from typing import Any

from openjiuwen.core.foundation.tool import Tool, ToolCard

from ..common import feishu_workflow


class BothouseFeishuTopicTaskTool(Tool):
    """Manage Feishu topic separation, in-place progress card updates, stuck checks, and delivery."""

    def __init__(self) -> None:
        super().__init__(
            ToolCard(
                id="bothouse_feishu_topic_task",
                name="bothouse_feishu_topic_task",
                description=(
                    "管理飞书任务话题与主群进度卡（需配合 bothouse-team-workflow skill）："
                    "action 支持 start（开话题+发进度卡）、update_progress（原地更新进度卡）、"
                    "post_topic（往话题发干活日志，不刷主群）、ask_main_group（回主群请人拍板）、"
                    "check_stuck（检查卡住并提醒）、complete（跑重复犯错检查并交回）。"
                ),
                input_params={
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "description": "操作类型：start | update_progress | post_topic | ask_main_group | check_stuck | complete",
                        },
                        "task_id": {"type": "string", "description": "任务 ID（start 时可传需求卡返回的 task_id）"},
                        "chat_id": {"type": "string", "description": "飞书群 chat_id（可选）"},
                        "title": {"type": "string", "description": "任务标题（可选）"},
                        "subtasks": {
                            "type": "array",
                            "description": "子任务列表（start 时用），每项含 id/name/owner/status",
                            "items": {"type": "object"},
                        },
                        "subtask_id": {"type": "string", "description": "子任务 ID（update_progress 时用）"},
                        "status": {"type": "string", "description": "状态：pending | in_progress | done | blocked"},
                        "note": {"type": "string", "description": "进度备注"},
                        "actor": {"type": "string", "description": "发言角色名（post_topic 时用，如 Claude/Codex）"},
                        "text": {"type": "string", "description": "消息正文（post_topic / ask_main_group / complete 用）"},
                        "evidence": {"type": "string", "description": "交回时的验证证据（complete 时用）"},
                    },
                    "required": ["action"],
                },
            )
        )

    async def invoke(self, inputs: dict[str, Any], **kwargs: Any) -> dict[str, Any]:
        try:
            action = str(inputs.get("action", "")).strip()
            task_id = str(inputs.get("task_id", "")).strip()
            if action == "start":
                return feishu_workflow.start_topic_task(
                    task_id=task_id,
                    subtasks=list(inputs.get("subtasks") or []),
                    chat_id=str(inputs.get("chat_id", "")),
                    title=str(inputs.get("title", "")),
                )
            if action == "update_progress":
                return feishu_workflow.update_progress(
                    task_id=task_id,
                    subtask_id=str(inputs.get("subtask_id", "1")),
                    status=str(inputs.get("status", "in_progress")),
                    note=str(inputs.get("note", "")),
                )
            if action == "post_topic":
                return feishu_workflow.post_topic_log(
                    task_id=task_id,
                    actor=str(inputs.get("actor", "Agent")),
                    text=str(inputs.get("text", "")),
                )
            if action == "ask_main_group":
                return feishu_workflow.ask_main_group(
                    task_id=task_id,
                    question=str(inputs.get("text", "")),
                )
            if action == "check_stuck":
                return feishu_workflow.check_stuck_tasks()
            if action == "complete":
                return feishu_workflow.complete_task(
                    task_id=task_id,
                    summary=str(inputs.get("text", "")),
                    evidence=str(inputs.get("evidence", "")),
                )
            return {"success": False, "error": f"unsupported action: {action}"}
        except Exception as exc:  # noqa: BLE001
            return {"success": False, "error": str(exc)}

    async def stream(self, inputs: dict[str, Any], **kwargs: Any):
        yield await self.invoke(inputs, **kwargs)
